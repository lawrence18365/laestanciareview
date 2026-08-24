// Read-only report: this script only selects push notification measurement data.
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

process.env.DOTENV_CONFIG_QUIET ??= 'true';
config({ path: '.env.production.local' });
config({ path: '.env.local' });

const USAGE = `Usage:
  npx tsx scripts/push-baseline.ts [--days N] [--json]

Options:
  --days N  Window sections 6, 7, and 8 to the last N days (default: 30)
  --json    Print one JSON object instead of tab-separated sections
  --help    Show this help`;

const BANNER_HISTORY_NOTE =
  'The push_banner_shown event was deployed on 2026-08-24 and has no history before that date.';

type LocationCountRow = {
  slug: string;
  count: number;
};

type UncoveredLocationRow = {
  slug: string;
  is_owner: boolean;
};

type RoleCountRow = {
  role: string;
  count: number;
};

type RevocationRow = {
  reason: 'endpoint_invalid' | 'permission_revoked' | 'unknown';
  slug: string | null;
  count: number;
};

type FunnelRow = {
  stage_order: number;
  stage: string;
  detail: string | null;
  count: number;
  previous_stage: string | null;
  previous_count: number | null;
  conversion_percent: number | null;
};

type PushRateRow = {
  slug: string;
  positive_review_pushes: number;
  active_devices: number;
  window_days: number;
  pushes_per_device_per_day: number | null;
};

type BannerShownRow = {
  state: string;
  slug: string;
  device_kind: string;
  count: number;
};

function parseArgs(args: string[]) {
  let days = 30;
  let json = false;
  let help = false;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--days') {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error('--days requires a positive integer');
      }
      days = Number(value);
      index++;
      if (!Number.isSafeInteger(days) || days <= 0) {
        throw new Error('--days requires a positive integer');
      }
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { days, help, json };
}

function printSection(
  heading: string,
  columns: string[],
  rows: Array<Array<string | number>>,
  notes: string[] = [],
) {
  process.stdout.write(`${heading}\n`);
  for (const note of notes) {
    process.stdout.write(`NOTE\t${note}\n`);
  }
  process.stdout.write(`${columns.join('\t')}\n`);
  for (const row of rows) {
    process.stdout.write(`${row.join('\t')}\n`);
  }
  process.stdout.write('\n');
}

function percent(value: number | null): string {
  return value === null ? '-' : `${Number(value).toFixed(1)}%`;
}

function rate(value: number | null): string {
  return value === null ? '-' : Number(value).toFixed(2);
}

async function rowsAs<T>(query: Promise<unknown>): Promise<T[]> {
  return (await query) as T[];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL?.replace(/\\n$/, '');
  if (!databaseUrl) {
    throw new Error('DATABASE_URL missing');
  }

  const sql = neon(databaseUrl);

  const [
    subscribedDevices,
    uncoveredLocations,
    subscriptionsByRole,
    explicitUnsubscribes,
    revocationsByReason,
    permissionFunnel,
    positiveReviewRates,
    bannerShownBreakdown,
  ] = await Promise.all([
    rowsAs<LocationCountRow>(sql`
      SELECT
        r.slug,
        COUNT(ps.id)::integer AS count
      FROM restaurants AS r
      INNER JOIN push_subscriptions AS ps
        ON ps.restaurant_id = r.id
      WHERE ps.revoked_at IS NULL
      GROUP BY r.slug
      ORDER BY r.slug
    `),

    rowsAs<UncoveredLocationRow>(sql`
      SELECT
        r.slug,
        r.is_owner
      FROM restaurants AS r
      WHERE r.is_regional IS FALSE
        AND NOT EXISTS (
          SELECT 1
          FROM push_subscriptions AS ps
          WHERE ps.restaurant_id = r.id
            AND ps.revoked_at IS NULL
        )
      ORDER BY r.is_owner DESC, r.slug
    `),

    rowsAs<RoleCountRow>(sql`
      SELECT
        COALESCE(ps.role, 'unknown') AS role,
        COUNT(*)::integer AS count
      FROM push_subscriptions AS ps
      WHERE ps.revoked_at IS NULL
      GROUP BY COALESCE(ps.role, 'unknown')
      ORDER BY role
    `),

    rowsAs<LocationCountRow>(sql`
      SELECT
        r.slug,
        COUNT(*)::integer AS count
      FROM push_subscriptions AS ps
      INNER JOIN restaurants AS r
        ON r.id = ps.restaurant_id
      WHERE ps.revoked_reason = 'user_unsubscribe'
      GROUP BY r.slug
      ORDER BY r.slug
    `),

    rowsAs<RevocationRow>(sql`
      WITH endpoint_invalid_by_slug AS (
        SELECT
          r.slug,
          COUNT(*)::integer AS count
        FROM push_subscriptions AS ps
        INNER JOIN restaurants AS r
          ON r.id = ps.restaurant_id
        WHERE ps.revoked_reason = 'endpoint_invalid'
        GROUP BY r.slug
      )
      SELECT
        1 AS reason_order,
        'endpoint_invalid'::text AS reason,
        endpoint.slug,
        endpoint.count
      FROM endpoint_invalid_by_slug AS endpoint

      UNION ALL

      SELECT
        1 AS reason_order,
        'endpoint_invalid'::text AS reason,
        NULL::text AS slug,
        0::integer AS count
      WHERE NOT EXISTS (SELECT 1 FROM endpoint_invalid_by_slug)

      UNION ALL

      SELECT
        2 AS reason_order,
        'permission_revoked'::text AS reason,
        NULL::text AS slug,
        COUNT(*)::integer AS count
      FROM push_subscriptions AS ps
      WHERE ps.revoked_reason = 'permission_revoked'

      UNION ALL

      SELECT
        3 AS reason_order,
        'unknown'::text AS reason,
        NULL::text AS slug,
        COUNT(*)::integer AS count
      FROM push_subscriptions AS ps
      WHERE ps.revoked_reason = 'unknown'

      ORDER BY reason_order, slug NULLS FIRST
    `),

    rowsAs<FunnelRow>(sql`
      WITH filtered_events AS (
        SELECT
          event_name,
          properties
        FROM product_events
        WHERE created_at >= NOW() - (${options.days} * INTERVAL '1 day')
          AND event_name IN (
            'push_banner_shown',
            'push_subscribe_click',
            'push_permission_result',
            'push_subscribe_failed',
            'push_banner_dismissed',
            'push_permission_revoked_detected'
          )
      ),
      totals AS (
        SELECT
          (COUNT(*) FILTER (
            WHERE event_name = 'push_banner_shown'
          ))::integer AS banner_shown,
          (COUNT(*) FILTER (
            WHERE event_name = 'push_subscribe_click'
          ))::integer AS subscribe_click,
          (COUNT(*) FILTER (
            WHERE event_name = 'push_banner_dismissed'
          ))::integer AS banner_dismissed,
          (COUNT(*) FILTER (
            WHERE event_name = 'push_permission_revoked_detected'
          ))::integer AS permission_revoked_detected
        FROM filtered_events
      ),
      permission_groups AS (
        SELECT
          COALESCE(NULLIF(properties ->> 'result', ''), 'unknown') AS detail,
          COUNT(*)::integer AS count
        FROM filtered_events
        WHERE event_name = 'push_permission_result'
        GROUP BY COALESCE(NULLIF(properties ->> 'result', ''), 'unknown')
      ),
      permission_rows AS (
        SELECT detail, count
        FROM permission_groups

        UNION ALL

        SELECT NULL::text AS detail, 0::integer AS count
        WHERE NOT EXISTS (SELECT 1 FROM permission_groups)
      ),
      failure_groups AS (
        SELECT
          COALESCE(NULLIF(properties ->> 'reason', ''), 'unknown') AS detail,
          COUNT(*)::integer AS count
        FROM filtered_events
        WHERE event_name = 'push_subscribe_failed'
        GROUP BY COALESCE(NULLIF(properties ->> 'reason', ''), 'unknown')
      ),
      failure_rows AS (
        SELECT detail, count
        FROM failure_groups

        UNION ALL

        SELECT NULL::text AS detail, 0::integer AS count
        WHERE NOT EXISTS (SELECT 1 FROM failure_groups)
      ),
      funnel_rows AS (
        SELECT
          1 AS stage_order,
          'push_banner_shown'::text AS stage,
          NULL::text AS detail,
          totals.banner_shown AS count,
          NULL::text AS previous_stage,
          NULL::integer AS previous_count
        FROM totals

        UNION ALL

        SELECT
          2 AS stage_order,
          'push_subscribe_click'::text AS stage,
          NULL::text AS detail,
          totals.subscribe_click AS count,
          'push_banner_shown'::text AS previous_stage,
          totals.banner_shown AS previous_count
        FROM totals

        UNION ALL

        SELECT
          3 AS stage_order,
          'push_permission_result'::text AS stage,
          permission.detail,
          permission.count,
          'push_subscribe_click'::text AS previous_stage,
          totals.subscribe_click AS previous_count
        FROM permission_rows AS permission
        CROSS JOIN totals

        UNION ALL

        SELECT
          4 AS stage_order,
          'push_subscribe_failed'::text AS stage,
          failure.detail,
          failure.count,
          'push_subscribe_click'::text AS previous_stage,
          totals.subscribe_click AS previous_count
        FROM failure_rows AS failure
        CROSS JOIN totals

        UNION ALL

        SELECT
          5 AS stage_order,
          'push_banner_dismissed'::text AS stage,
          NULL::text AS detail,
          totals.banner_dismissed AS count,
          'push_banner_shown'::text AS previous_stage,
          totals.banner_shown AS previous_count
        FROM totals

        UNION ALL

        SELECT
          6 AS stage_order,
          'push_permission_revoked_detected'::text AS stage,
          NULL::text AS detail,
          totals.permission_revoked_detected AS count,
          NULL::text AS previous_stage,
          NULL::integer AS previous_count
        FROM totals
      )
      SELECT
        stage_order,
        stage,
        detail,
        count,
        previous_stage,
        previous_count,
        CASE
          WHEN previous_count IS NULL OR previous_count = 0 THEN NULL
          ELSE ROUND((count::numeric * 100) / previous_count, 1)::double precision
        END AS conversion_percent
      FROM funnel_rows
      ORDER BY stage_order, detail NULLS FIRST
    `),

    // The two aggregates below are intentionally independent. Joining the
    // underlying subscription and notification rows would multiply both.
    rowsAs<PushRateRow>(sql`
      WITH measurement_window AS (
        SELECT
          clock.window_end - (${options.days} * INTERVAL '1 day') AS window_start,
          clock.window_end
        FROM (SELECT NOW() AS window_end) AS clock
      ),
      reporting_window AS (
        SELECT
          window_start,
          window_end,
          GREATEST(
            1,
            (window_end AT TIME ZONE 'America/Mexico_City')::date
              - (window_start AT TIME ZONE 'America/Mexico_City')::date
          )::integer AS window_days
        FROM measurement_window
      ),
      active_devices AS (
        SELECT
          restaurant_id,
          COUNT(*)::integer AS active_devices
        FROM push_subscriptions
        WHERE revoked_at IS NULL
        GROUP BY restaurant_id
      ),
      notification_metrics AS (
        SELECT
          notifications.restaurant_id,
          COUNT(*)::integer AS positive_review_pushes
        FROM push_notifications AS notifications
        CROSS JOIN reporting_window AS rw
        WHERE notifications.kind = 'positive_review'
          AND notifications.created_at >= rw.window_start
          AND notifications.created_at <= rw.window_end
        GROUP BY notifications.restaurant_id
      )
      SELECT
        r.slug,
        COALESCE(notifications.positive_review_pushes, 0)::integer AS positive_review_pushes,
        COALESCE(devices.active_devices, 0)::integer AS active_devices,
        rw.window_days,
        CASE
          WHEN COALESCE(devices.active_devices, 0) = 0 THEN NULL
          WHEN COALESCE(notifications.positive_review_pushes, 0) = 0 THEN 0::double precision
          ELSE (
            notifications.positive_review_pushes::numeric
            / devices.active_devices
            / rw.window_days
          )::double precision
        END AS pushes_per_device_per_day
      FROM restaurants AS r
      CROSS JOIN reporting_window AS rw
      LEFT JOIN active_devices AS devices
        ON devices.restaurant_id = r.id
      LEFT JOIN notification_metrics AS notifications
        ON notifications.restaurant_id = r.id
      WHERE r.is_regional IS FALSE
      ORDER BY r.slug
    `),

    rowsAs<BannerShownRow>(sql`
      SELECT
        COALESCE(NULLIF(events.properties ->> 'state', ''), 'unknown') AS state,
        COALESCE(restaurants.slug, 'unknown') AS slug,
        COALESCE(
          NULLIF(events.properties ->> 'device_kind', ''),
          'unknown'
        ) AS device_kind,
        COUNT(*)::integer AS count
      FROM product_events AS events
      LEFT JOIN restaurants
        ON restaurants.id = events.restaurant_id
      WHERE events.event_name = 'push_banner_shown'
        AND events.created_at >= NOW() - (${options.days} * INTERVAL '1 day')
      GROUP BY
        COALESCE(NULLIF(events.properties ->> 'state', ''), 'unknown'),
        COALESCE(restaurants.slug, 'unknown'),
        COALESCE(
          NULLIF(events.properties ->> 'device_kind', ''),
          'unknown'
        )
      ORDER BY state, slug, device_kind
    `),
  ]);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      days: options.days,
      subscribed_devices_by_location: subscribedDevices,
      uncovered_operational_locations: uncoveredLocations.map((row) => ({
        ...row,
        account_type: row.is_owner ? 'OWNER ACCOUNT' : 'OPERATIONAL LOCATION',
      })),
      subscriptions_by_role: subscriptionsByRole,
      explicit_unsubscribe_count: explicitUnsubscribes,
      revocations_by_reason: revocationsByReason,
      permission_funnel: permissionFunnel,
      positive_review_pushes_per_device_per_day: positiveReviewRates,
      banner_shown_by_state_location_device_kind: {
        note: BANNER_HISTORY_NOTE,
        rows: bannerShownBreakdown,
      },
    })}\n`);
    return;
  }

  printSection(
    'SUBSCRIBED DEVICES BY LOCATION',
    ['slug', 'active_devices'],
    subscribedDevices.map((row) => [row.slug, row.count]),
  );

  printSection(
    'UNCOVERED OPERATIONAL LOCATIONS',
    ['slug', 'account_type'],
    uncoveredLocations.map((row) => [
      row.slug,
      row.is_owner ? 'OWNER ACCOUNT' : 'OPERATIONAL LOCATION',
    ]),
  );

  printSection(
    'SUBSCRIPTIONS BY ROLE',
    ['role', 'active_subscriptions'],
    subscriptionsByRole.map((row) => [row.role, row.count]),
  );

  printSection(
    'EXPLICIT UNSUBSCRIBE COUNT',
    ['slug', 'user_unsubscribe_count'],
    explicitUnsubscribes.length === 0
      ? [['none', 0]]
      : explicitUnsubscribes.map((row) => [row.slug, row.count]),
  );

  printSection(
    'REVOCATIONS BY REASON',
    ['reason', 'slug_or_scope', 'count'],
    revocationsByReason.map((row) => [
      row.reason,
      row.slug ?? 'ALL LOCATIONS',
      row.count,
    ]),
  );

  printSection(
    'PERMISSION FUNNEL',
    ['stage', 'detail', 'count', 'previous_stage', 'conversion_from_previous'],
    permissionFunnel.map((row) => [
      row.stage,
      row.detail ?? '',
      row.count,
      row.previous_stage ?? '',
      percent(row.conversion_percent),
    ]),
    [`Window: last ${options.days} days`],
  );

  printSection(
    'POSITIVE-REVIEW PUSHES PER DEVICE PER DAY',
    [
      'slug',
      'positive_review_pushes',
      'active_devices',
      'window_days',
      'pushes_per_device_per_day',
    ],
    positiveReviewRates.map((row) => [
      row.slug,
      row.positive_review_pushes,
      row.active_devices,
      row.window_days,
      rate(row.pushes_per_device_per_day),
    ]),
    [
      `Uniform window_days: ${positiveReviewRates[0]?.window_days ?? 1}. Every location divides by this value.`,
    ],
  );

  printSection(
    'BANNER SHOWN BY STATE, LOCATION, DEVICE KIND',
    ['state', 'slug', 'device_kind', 'count'],
    bannerShownBreakdown.length === 0
      ? [['none', '', '', 0]]
      : bannerShownBreakdown.map((row) => [
        row.state,
        row.slug,
        row.device_kind,
        row.count,
      ]),
    [`Window: last ${options.days} days`, BANNER_HISTORY_NOTE],
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
