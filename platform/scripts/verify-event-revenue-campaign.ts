/** Read-only operational check for the seeded Estancia León event campaign. */
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });
neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);

  const pool = new Pool({ connectionString: url });
  try {
    const result = await pool.query(`
      WITH contact_stats AS (
        SELECT
          cc.campaign_id,
          COUNT(*)::int AS audience,
          COUNT(*) FILTER (WHERE cc.opened_at IS NOT NULL)::int AS opened,
          COUNT(*) FILTER (WHERE cc.sent_at IS NOT NULL)::int AS sent,
          COUNT(*) FILTER (WHERE cc.status = 'booked')::int AS booked_contacts,
          COUNT(*) FILTER (
            WHERE g.status <> 'validated' OR g.marketing_consent IS NOT TRUE
          )::int AS now_ineligible
        FROM campaign_contacts cc
        JOIN guests g ON g.id = cc.guest_id
        GROUP BY cc.campaign_id
      ), booking_stats AS (
        SELECT
          campaign_id,
          COUNT(*)::int AS bookings,
          COALESCE(SUM(party_size) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0)::int AS seats,
          COALESCE(SUM(booked_amount) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0)::numeric AS booked_revenue,
          COALESCE(SUM(fee_amount) FILTER (WHERE status NOT IN ('cancelled','refunded')), 0)::numeric AS performance_fee
        FROM campaign_bookings
        GROUP BY campaign_id
      )
      SELECT
        ec.id,
        ec.status,
        COALESCE(cs.audience, 0) AS audience,
        COALESCE(cs.opened, 0) AS opened,
        COALESCE(cs.sent, 0) AS sent,
        COALESCE(cs.booked_contacts, 0) AS booked_contacts,
        COALESCE(bs.bookings, 0) AS bookings,
        COALESCE(bs.seats, 0) AS seats,
        COALESCE(bs.booked_revenue, 0) AS booked_revenue,
        COALESCE(bs.performance_fee, 0) AS performance_fee,
        COALESCE(cs.now_ineligible, 0) AS now_ineligible
      FROM event_campaigns ec
      JOIN restaurants r ON r.id = ec.restaurant_id
      LEFT JOIN contact_stats cs ON cs.campaign_id = ec.id
      LEFT JOIN booking_stats bs ON bs.campaign_id = ec.id
      WHERE r.slug = 'estancia-leon'
        AND ec.slug = 'cena-maridaje-santo-tomas-2026-07-30'
    `);

    const row = result.rows[0];
    if (!row) throw new Error('Seeded campaign not found');
    console.log(JSON.stringify(row, null, 2));
    if (row.now_ineligible > 0) {
      console.log('Note: ineligible contacts remain frozen for audit history and are blocked at open/send time.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('✗ Campaign verification failed:', error);
  process.exit(1);
});
