/**
 * Create the Estancia León wine-dinner campaign and freeze only validated,
 * marketing-consented guests into its audience. No messages are sent.
 */
import { config } from 'dotenv';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });
neonConfig.webSocketConstructor = ws;

const MESSAGE = `🍷 *CENA MARIDAJE · SANTO TOMÁS* 🍷
La Estancia Argentina León

Una noche en Valle de Santo Tomás, sin salir de León.

4 vinos de *Bodegas Santo Tomás* — la bodega más antigua de México — maridados en 4 tiempos por nuestro chef, con *cata dirigida por su embajadora.*

🗓 Jueves 30 de julio · 8:00 PM
🍽 4 tiempos · 4 vinos
💵 $1,599 por persona
📍 Cupo limitado

Reserva con anticipo para apartar tu lugar. Escríbenos por aquí y con gusto te atendemos. 🥂`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const restaurantResult = await client.query(
      `SELECT id FROM restaurants WHERE slug=$1 LIMIT 1`,
      ['estancia-leon'],
    );
    const restaurantId = restaurantResult.rows[0]?.id as number | undefined;
    if (!restaurantId) throw new Error('estancia-leon restaurant not found');

    await client.query(
      `INSERT INTO event_campaigns (
         restaurant_id, slug, name, campaign_type, audience_rule, status,
         event_date, event_time, offer_name, message_text, price_per_person,
         capacity, minimum_seats, baseline_seats, attribution_days, fee_percent
       ) VALUES ($1,$2,$3,'house_event','all_consented','ready',$4,$5,$6,$7,$8,$9,$10,0,30,12)
       ON CONFLICT (restaurant_id, slug) DO NOTHING`,
      [
        restaurantId,
        'cena-maridaje-santo-tomas-2026-07-30',
        'Cena Maridaje Santo Tomás',
        '2026-07-30',
        '20:00',
        '4 tiempos · 4 vinos · cata dirigida',
        MESSAGE,
        '1599.00',
        40,
        20,
      ],
    );

    const campaignResult = await client.query(
      `SELECT id FROM event_campaigns WHERE restaurant_id=$1 AND slug=$2 LIMIT 1`,
      [restaurantId, 'cena-maridaje-santo-tomas-2026-07-30'],
    );
    const campaignId = campaignResult.rows[0]?.id as number | undefined;
    if (!campaignId) throw new Error('campaign was not created');

    await client.query(
      `INSERT INTO campaign_contacts (
         campaign_id, restaurant_id, guest_id, segment, priority
       )
       SELECT
         $1,
         $2,
         g.id,
         CASE
           WHEN g.redemption_type = 'copa_vino' THEN 'wine_redeemer'
           WHEN EXISTS (
             SELECT 1 FROM unnest(COALESCE(g.preferences, ARRAY[]::text[])) p
             WHERE lower(p) = 'vino'
           ) OR lower(COALESCE(g.promo_type,'')) IN ('wine','vino','copa')
             THEN 'wine_preference'
           WHEN COUNT(gv.id) >= 5 THEN 'vip'
           ELSE 'general'
         END,
         CASE
           WHEN g.redemption_type = 'copa_vino' THEN 10
           WHEN EXISTS (
             SELECT 1 FROM unnest(COALESCE(g.preferences, ARRAY[]::text[])) p
             WHERE lower(p) = 'vino'
           ) OR lower(COALESCE(g.promo_type,'')) IN ('wine','vino','copa')
             THEN 20
           WHEN COUNT(gv.id) >= 5 THEN 30
           ELSE 100
         END
       FROM guests g
       JOIN guest_visits gv ON gv.guest_id = g.id AND gv.restaurant_id = $2
       WHERE g.status = 'validated' AND g.marketing_consent = true
       GROUP BY g.id
       ON CONFLICT (campaign_id, guest_id) DO NOTHING`,
      [campaignId, restaurantId],
    );

    await client.query(
      `UPDATE event_campaigns SET audience_seeded_at=COALESCE(audience_seeded_at,now()), updated_at=now()
       WHERE id=$1 AND restaurant_id=$2`,
      [campaignId, restaurantId],
    );
    await client.query('COMMIT');

    const verification = await pool.query(
      `SELECT segment, status, COUNT(*)::int AS n
       FROM campaign_contacts WHERE campaign_id=$1
       GROUP BY segment,status
       ORDER BY CASE segment
         WHEN 'wine_redeemer' THEN 10
         WHEN 'wine_preference' THEN 20
         WHEN 'vip' THEN 30
         ELSE 100
       END, status`,
      [campaignId],
    );
    const total = verification.rows.reduce((sum, row: { n: number }) => sum + row.n, 0);
    console.log(`campaign_id: ${campaignId}`);
    console.log('audience:', verification.rows);
    console.log(`total contactable contacts: ${total}`);
    console.log('✓ Campaign ready. No messages were sent.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('✗ Campaign seed failed:', error);
  process.exit(1);
});
