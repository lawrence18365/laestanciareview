/**
 * State-of-business research pull. Runs read-only queries across every relevant
 * table and prints a structured snapshot for ROI prioritization.
 *
 * Usage:
 *   ENV_FILE=.env.production.local npx tsx scripts/state-of-business.ts
 */
import { config } from 'dotenv';
const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

interface Section {
  title: string;
  data: unknown;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);
  const pool = new Pool({ connectionString: url });

  const sections: Section[] = [];
  const q = async (sql: string, label: string) => {
    try {
      const r = await pool.query(sql);
      return r.rows;
    } catch (e) {
      return [{ ERROR: (e as Error).message, query: label }];
    }
  };

  try {
    // ── 1. Restaurants / customer base ──────────────────────────────────────
    sections.push({
      title: '1. CUSTOMER BASE — restaurants table',
      data: {
        total_rows: await q(`SELECT COUNT(*)::int AS n FROM restaurants`, 'rest_total'),
        by_subscription_status: await q(
          `SELECT subscription_status, COUNT(*)::int AS n FROM restaurants GROUP BY 1 ORDER BY n DESC`,
          'rest_subs',
        ),
        by_role_flags: await q(
          `SELECT
             SUM(CASE WHEN is_owner THEN 1 ELSE 0 END)::int AS owner_rows,
             SUM(CASE WHEN is_regional THEN 1 ELSE 0 END)::int AS regional_rows,
             SUM(CASE WHEN NOT is_owner AND NOT is_regional THEN 1 ELSE 0 END)::int AS customer_rows
           FROM restaurants`,
          'rest_flags',
        ),
        with_stripe_subscription: await q(
          `SELECT COUNT(*)::int AS n FROM restaurants WHERE stripe_subscription_id IS NOT NULL`,
          'rest_stripe',
        ),
        in_trial: await q(
          `SELECT COUNT(*)::int AS n FROM restaurants WHERE trial_ends_at IS NOT NULL AND trial_ends_at > now()`,
          'rest_trial_active',
        ),
        trial_expired_unconverted: await q(
          `SELECT COUNT(*)::int AS n FROM restaurants
           WHERE trial_ends_at IS NOT NULL AND trial_ends_at <= now()
             AND (stripe_subscription_id IS NULL OR subscription_status NOT IN ('active','trialing'))
             AND NOT is_owner AND NOT is_regional`,
          'rest_trial_lost',
        ),
        by_brand: await q(
          `SELECT COALESCE(brand, '(null)') AS brand, COUNT(*)::int AS n
           FROM restaurants WHERE NOT is_owner AND NOT is_regional GROUP BY 1 ORDER BY n DESC`,
          'rest_brand',
        ),
        signups_recent: await q(
          `SELECT
             SUM(CASE WHEN created_at > now() - interval '7 days'  THEN 1 ELSE 0 END)::int AS d7,
             SUM(CASE WHEN created_at > now() - interval '30 days' THEN 1 ELSE 0 END)::int AS d30,
             SUM(CASE WHEN created_at > now() - interval '90 days' THEN 1 ELSE 0 END)::int AS d90,
             SUM(CASE WHEN created_at > now() - interval '180 days' THEN 1 ELSE 0 END)::int AS d180
           FROM restaurants WHERE NOT is_owner AND NOT is_regional`,
          'rest_signups',
        ),
        all_customers_detail: await q(
          `SELECT id, name, slug, brand, subscription_status,
                  stripe_subscription_id IS NOT NULL AS has_stripe,
                  trial_ends_at,
                  created_at::date AS created,
                  google_rating, google_review_count
           FROM restaurants WHERE NOT is_owner AND NOT is_regional ORDER BY created_at`,
          'rest_detail',
        ),
      },
    });

    // ── 2. Reviews — engagement + product usage ──────────────────────────────
    sections.push({
      title: '2. PRODUCT USAGE — reviews table',
      data: {
        total: await q(`SELECT COUNT(*)::int AS n FROM reviews`, 'rev_total'),
        recent: await q(
          `SELECT
             SUM(CASE WHEN created_at > now() - interval '7 days'  THEN 1 ELSE 0 END)::int AS d7,
             SUM(CASE WHEN created_at > now() - interval '30 days' THEN 1 ELSE 0 END)::int AS d30,
             SUM(CASE WHEN created_at > now() - interval '90 days' THEN 1 ELSE 0 END)::int AS d90
           FROM reviews`,
          'rev_recent',
        ),
        by_rating: await q(
          `SELECT rating, COUNT(*)::int AS n FROM reviews GROUP BY 1 ORDER BY 1`,
          'rev_rating',
        ),
        sent_to_google_share: await q(
          `SELECT
             SUM(CASE WHEN sent_to_google THEN 1 ELSE 0 END)::int AS to_google,
             SUM(CASE WHEN NOT sent_to_google THEN 1 ELSE 0 END)::int AS to_feedback,
             SUM(CASE WHEN feedback IS NOT NULL THEN 1 ELSE 0 END)::int AS feedback_filled
           FROM reviews`,
          'rev_routing',
        ),
        per_restaurant_30d: await q(
          `SELECT r.id, r.name, r.subscription_status,
                  COUNT(rv.id)::int AS reviews_30d,
                  SUM(CASE WHEN rv.sent_to_google THEN 1 ELSE 0 END)::int AS google_30d,
                  SUM(CASE WHEN rv.feedback IS NOT NULL THEN 1 ELSE 0 END)::int AS feedback_30d
           FROM restaurants r
           LEFT JOIN reviews rv ON rv.restaurant_id = r.id AND rv.created_at > now() - interval '30 days'
           WHERE NOT r.is_owner AND NOT r.is_regional
           GROUP BY r.id, r.name, r.subscription_status
           ORDER BY reviews_30d DESC`,
          'rev_per_rest',
        ),
        silent_restaurants_30d: await q(
          `SELECT COUNT(*)::int AS n
           FROM restaurants r
           WHERE NOT r.is_owner AND NOT r.is_regional
             AND NOT EXISTS (SELECT 1 FROM reviews WHERE restaurant_id = r.id AND created_at > now() - interval '30 days')`,
          'rev_silent',
        ),
        most_recent_review_per_restaurant: await q(
          `SELECT r.id, r.name, r.subscription_status,
                  MAX(rv.created_at)::date AS last_review_date,
                  EXTRACT(EPOCH FROM (now() - MAX(rv.created_at))) / 86400 AS days_since_last_review
           FROM restaurants r
           LEFT JOIN reviews rv ON rv.restaurant_id = r.id
           WHERE NOT r.is_owner AND NOT r.is_regional
           GROUP BY r.id, r.name, r.subscription_status
           ORDER BY last_review_date DESC NULLS LAST`,
          'rev_freshness',
        ),
      },
    });

    // ── 3. Quotes — sales pipeline ───────────────────────────────────────────
    sections.push({
      title: '3. SALES PIPELINE — quotes table',
      data: {
        total: await q(`SELECT COUNT(*)::int AS n FROM quotes`, 'q_total'),
        by_status: await q(
          `SELECT status, COUNT(*)::int AS n FROM quotes GROUP BY 1 ORDER BY n DESC`,
          'q_status',
        ),
        recent: await q(
          `SELECT
             SUM(CASE WHEN created_at > now() - interval '7 days'  THEN 1 ELSE 0 END)::int AS d7,
             SUM(CASE WHEN created_at > now() - interval '30 days' THEN 1 ELSE 0 END)::int AS d30,
             SUM(CASE WHEN created_at > now() - interval '90 days' THEN 1 ELSE 0 END)::int AS d90
           FROM quotes`,
          'q_recent',
        ),
        dollars_open: await q(
          `SELECT
             status,
             COUNT(*)::int AS n,
             ROUND(SUM(NULLIF(price_per_person,'')::numeric * guest_count)::numeric, 0)::int AS gross_value
           FROM quotes
           WHERE price_per_person ~ '^[0-9]+(\\.[0-9]+)?$'
           GROUP BY status
           ORDER BY gross_value DESC NULLS LAST`,
          'q_dollars',
        ),
        per_restaurant: await q(
          `SELECT r.name, COUNT(q.id)::int AS quotes,
                  SUM(CASE WHEN q.status = 'sent' THEN 1 ELSE 0 END)::int AS sent,
                  SUM(CASE WHEN q.status = 'accepted' THEN 1 ELSE 0 END)::int AS accepted,
                  MAX(q.created_at)::date AS last_quote
           FROM restaurants r
           LEFT JOIN quotes q ON q.restaurant_id = r.id
           WHERE NOT r.is_owner AND NOT r.is_regional
           GROUP BY r.id, r.name
           ORDER BY quotes DESC`,
          'q_per_rest',
        ),
        avg_event_size_last_90d: await q(
          `SELECT
             ROUND(AVG(guest_count)::numeric, 1) AS avg_guests,
             ROUND(AVG(NULLIF(price_per_person,'')::numeric)::numeric, 0) AS avg_pp_pesos
           FROM quotes
           WHERE created_at > now() - interval '90 days'
             AND price_per_person ~ '^[0-9]+(\\.[0-9]+)?$'`,
          'q_avg',
        ),
      },
    });

    // ── 4. Prospect outbound ─────────────────────────────────────────────────
    sections.push({
      title: '4. OUTBOUND PIPELINE — prospect_queue table',
      data: {
        total: await q(`SELECT COUNT(*)::int AS n FROM prospect_queue`, 'pq_total'),
        by_status: await q(
          `SELECT status, COUNT(*)::int AS n FROM prospect_queue GROUP BY 1 ORDER BY n DESC`,
          'pq_status',
        ),
        funnel: await q(
          `SELECT
             COUNT(*)::int AS total,
             SUM(CASE WHEN contacted_at IS NOT NULL THEN 1 ELSE 0 END)::int AS contacted,
             SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END)::int AS replied
           FROM prospect_queue`,
          'pq_funnel',
        ),
        by_city: await q(
          `SELECT COALESCE(city, '(null)') AS city, COUNT(*)::int AS n FROM prospect_queue GROUP BY 1 ORDER BY n DESC LIMIT 20`,
          'pq_city',
        ),
        recent_contact: await q(
          `SELECT
             SUM(CASE WHEN contacted_at > now() - interval '7 days'  THEN 1 ELSE 0 END)::int AS contacted_7d,
             SUM(CASE WHEN contacted_at > now() - interval '30 days' THEN 1 ELSE 0 END)::int AS contacted_30d,
             SUM(CASE WHEN replied_at > now() - interval '30 days' THEN 1 ELSE 0 END)::int AS replied_30d
           FROM prospect_queue`,
          'pq_activity',
        ),
        last_contact_at: await q(
          `SELECT MAX(contacted_at) AS last FROM prospect_queue`,
          'pq_lastcontact',
        ),
      },
    });

    // ── 5. Audit page funnel ─────────────────────────────────────────────────
    sections.push({
      title: '5. AUDIT FUNNEL — prospect_views table',
      data: {
        unique_placeids_total: await q(`SELECT COUNT(*)::int AS n FROM prospect_views`, 'pv_total'),
        unique_placeids_30d: await q(
          `SELECT COUNT(*)::int AS n FROM prospect_views WHERE last_view_at > now() - interval '30 days'`,
          'pv_30d',
        ),
        total_views: await q(
          `SELECT COALESCE(SUM(view_count),0)::int AS n FROM prospect_views`,
          'pv_views',
        ),
        all: await q(
          `SELECT restaurant_name, view_count, rating, last_view_at::date AS last_view, first_view_at::date AS first_view
           FROM prospect_views ORDER BY view_count DESC`,
          'pv_all',
        ),
      },
    });

    // ── 6. Guest Capture CRM adoption ────────────────────────────────────────
    sections.push({
      title: '6. GUEST CRM — guests + guest_visits',
      data: {
        guests_total: await q(`SELECT COUNT(*)::int AS n FROM guests`, 'g_total'),
        guests_by_status: await q(
          `SELECT status::text, COUNT(*)::int AS n FROM guests GROUP BY 1 ORDER BY n DESC`,
          'g_status',
        ),
        guests_recent: await q(
          `SELECT
             SUM(CASE WHEN captured_at > now() - interval '7 days'  THEN 1 ELSE 0 END)::int AS d7,
             SUM(CASE WHEN captured_at > now() - interval '30 days' THEN 1 ELSE 0 END)::int AS d30,
             SUM(CASE WHEN captured_at > now() - interval '90 days' THEN 1 ELSE 0 END)::int AS d90
           FROM guests`,
          'g_recent',
        ),
        guests_per_restaurant: await q(
          `SELECT r.name, COUNT(g.id)::int AS guests,
                  SUM(CASE WHEN g.marketing_consent THEN 1 ELSE 0 END)::int AS consented
           FROM restaurants r
           LEFT JOIN guests g ON g.restaurant_id = r.id
           WHERE NOT r.is_owner AND NOT r.is_regional
           GROUP BY r.id, r.name
           ORDER BY guests DESC`,
          'g_per_rest',
        ),
        marketing_consent_rate: await q(
          `SELECT ROUND(100.0 * SUM(CASE WHEN marketing_consent THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS pct FROM guests`,
          'g_consent',
        ),
        visits_total: await q(`SELECT COUNT(*)::int AS n FROM guest_visits`, 'gv_total'),
        visits_recent_30d: await q(
          `SELECT COUNT(*)::int AS n FROM guest_visits WHERE visit_date > now() - interval '30 days'`,
          'gv_30d',
        ),
      },
    });

    // ── 7. Google rating progression — does the product work? ────────────────
    sections.push({
      title: '7. PRODUCT EFFICACY — google_rating_snapshots',
      data: {
        snapshots_total: await q(`SELECT COUNT(*)::int AS n FROM google_rating_snapshots`, 'grs_total'),
        restaurants_with_multiple: await q(
          `SELECT COUNT(*)::int AS n FROM (
             SELECT restaurant_id FROM google_rating_snapshots GROUP BY restaurant_id HAVING COUNT(*) > 1
           ) sub`,
          'grs_multi',
        ),
        rating_delta_per_restaurant: await q(
          `WITH first_last AS (
             SELECT restaurant_id,
                    (array_agg(rating ORDER BY captured_at ASC))[1]::numeric AS first_rating,
                    (array_agg(rating ORDER BY captured_at DESC))[1]::numeric AS latest_rating,
                    (array_agg(review_count ORDER BY captured_at ASC))[1] AS first_count,
                    (array_agg(review_count ORDER BY captured_at DESC))[1] AS latest_count,
                    MIN(captured_at)::date AS first_at,
                    MAX(captured_at)::date AS latest_at,
                    COUNT(*)::int AS n_snapshots
             FROM google_rating_snapshots GROUP BY restaurant_id
           )
           SELECT r.name, r.subscription_status,
                  fl.first_rating, fl.latest_rating,
                  ROUND(fl.latest_rating - fl.first_rating, 2) AS rating_delta,
                  fl.first_count, fl.latest_count,
                  fl.latest_count - fl.first_count AS review_growth,
                  fl.first_at, fl.latest_at, fl.n_snapshots
           FROM first_last fl
           JOIN restaurants r ON r.id = fl.restaurant_id
           WHERE NOT r.is_owner AND NOT r.is_regional
           ORDER BY rating_delta DESC NULLS LAST`,
          'grs_delta',
        ),
      },
    });

    // ── 8. Staff / setup completion ──────────────────────────────────────────
    sections.push({
      title: '8. SETUP COMPLETION — staff per restaurant',
      data: {
        no_staff: await q(
          `SELECT COUNT(*)::int AS n FROM restaurants r
           WHERE NOT r.is_owner AND NOT r.is_regional
             AND NOT EXISTS (SELECT 1 FROM staff WHERE restaurant_id = r.id AND active)`,
          's_none',
        ),
        staff_distribution: await q(
          `SELECT r.name, r.subscription_status,
                  (SELECT COUNT(*)::int FROM staff WHERE restaurant_id = r.id AND active) AS active_staff
           FROM restaurants r
           WHERE NOT r.is_owner AND NOT r.is_regional
           ORDER BY active_staff ASC`,
          's_dist',
        ),
      },
    });

    // ── 9. Trial nurture activity ────────────────────────────────────────────
    sections.push({
      title: '9. TRIAL NURTURE — nurture_events table',
      data: {
        total: await q(`SELECT COUNT(*)::int AS n FROM nurture_events`, 'n_total'),
        by_event: await q(
          `SELECT event, COUNT(*)::int AS n FROM nurture_events GROUP BY 1 ORDER BY 1`,
          'n_event',
        ),
        recent_30d: await q(
          `SELECT COUNT(*)::int AS n FROM nurture_events WHERE sent_at > now() - interval '30 days'`,
          'n_30d',
        ),
        last_fired: await q(
          `SELECT MAX(sent_at) AS last FROM nurture_events`,
          'n_last',
        ),
      },
    });

    // ── 10. Push subscriptions adoption ──────────────────────────────────────
    sections.push({
      title: '10. PUSH ADOPTION — push_subscriptions table',
      data: {
        active: await q(
          `SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE revoked_at IS NULL`,
          'p_active',
        ),
        revoked: await q(
          `SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE revoked_at IS NOT NULL`,
          'p_revoked',
        ),
        revoked_by_reason: await q(
          `SELECT COALESCE(revoked_reason, 'unknown') AS reason, COUNT(*)::int AS n
           FROM push_subscriptions
           WHERE revoked_at IS NOT NULL
           GROUP BY 1
           ORDER BY 1`,
          'p_revoked_reason',
        ),
        active_unique_restaurants: await q(
          `SELECT COUNT(DISTINCT restaurant_id)::int AS n
           FROM push_subscriptions
           WHERE revoked_at IS NULL`,
          'p_uniq',
        ),
      },
    });

    console.log(JSON.stringify({ env_file: envFile, generated_at: new Date().toISOString(), sections }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
