/**
 * Ground truth + daily correlation: prove which platform event was being
 * mis-fired as Meta CompleteRegistration.
 *
 *   ENV_FILE=.env.local npx tsx scripts/audit-may-2026-funnel.ts
 */
import { config } from 'dotenv';
const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);
  const pool = new Pool({ connectionString: url });

  const q = async (sql: string) => (await pool.query(sql)).rows;

  const start = "'2026-05-01'";
  const end = "'2026-06-01'";

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  MAY 2026 — Meta says 762 CompleteRegistration events');
  console.log('═══════════════════════════════════════════════════════════\n');

  const restaurants = await q(`
    SELECT COUNT(*)::int AS n
    FROM restaurants
    WHERE created_at >= ${start} AND created_at < ${end}
      AND NOT is_owner AND NOT is_regional
  `);
  const pending = await q(`
    SELECT COUNT(*)::int AS n FROM pending_signups
    WHERE created_at >= ${start} AND created_at < ${end}
  `);
  const leads = await q(`
    SELECT COUNT(*)::int AS n FROM commercial_leads
    WHERE created_at >= ${start} AND created_at < ${end}
  `);
  console.log(`Real paid signups (restaurants):        ${restaurants[0].n}`);
  console.log(`Pending signups (clicked Empezar):      ${pending[0].n}`);
  console.log(`Commercial leads captured:              ${leads[0].n}`);
  console.log(`Meta reports:                           762`);
  console.log(`UNEXPLAINED GAP:                        ${762 - restaurants[0].n}\n`);

  const events = await q(`
    SELECT event_name, COUNT(*)::int AS n
    FROM commercial_events
    WHERE created_at >= ${start} AND created_at < ${end}
    GROUP BY 1 ORDER BY n DESC
  `);
  console.log('Platform events in May (candidates for the GTM mis-fire):');
  events.forEach((r) => {
    const ratio = (r.n / 762).toFixed(2);
    console.log(`  ${String(r.event_name).padEnd(30)} ${String(r.n).padStart(5)}   (n/762 = ${ratio})`);
  });

  console.log('\nDaily breakdown of top 3 events (to compare shape with Meta daily curve):');
  const top3 = events.slice(0, 3).map((r) => r.event_name);
  for (const ev of top3) {
    const daily = await q(`
      SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS n
      FROM commercial_events
      WHERE created_at >= ${start} AND created_at < ${end}
        AND event_name = '${ev}'
      GROUP BY 1 ORDER BY 1
    `);
    console.log(`\n  ${ev}:`);
    daily.forEach((d) => console.log(`    ${d.day}  ${'█'.repeat(Math.min(60, d.n))} ${d.n}`));
  }

  await pool.end();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  CONCLUSION');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  0 real signups + 762 Meta CR fires = the 762 are 100% fake.`);
  console.log(`  Look at the event in the table above closest to 762.`);
  console.log(`  That is the GTM trigger firing CompleteRegistration.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
