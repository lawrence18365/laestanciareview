#!/usr/bin/env npx tsx
/**
 * Run the outreach 3-touch email sequence.
 *
 * Usage:
 *   npx tsx scripts/outreach-email-run.ts                          # dry run: prints the plan and full rendered emails
 *   npx tsx scripts/outreach-email-run.ts --send                   # send (only inside the Mon-Sat 10:00-12:59 Mexico window)
 *   npx tsx scripts/outreach-email-run.ts --send --ignore-window   # send regardless of the window
 *
 * Safety: nothing is planned or sent unless OUTREACH_EMAIL_ENABLED=true.
 */
import { config } from 'dotenv';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });

async function main() {
  const send = process.argv.includes('--send');
  const ignoreWindow = process.argv.includes('--ignore-window');

  const { runOutreachBatch } = await import('../src/lib/outreach-engine');

  const result = await runOutreachBatch({ send, ignoreWindow });

  if (!send) {
    if (result.planned.length === 0) {
      console.log(`Dry run: nothing planned${result.skipped ? ` (skipped: ${result.skipped})` : ''}.`);
    } else {
      const { db } = await import('../src/db');
      const { outreachProspects } = await import('../src/db/schema');
      const { eq } = await import('drizzle-orm');
      const { buildOutreachEmail } = await import('../src/lib/outreach-templates');

      console.log(`Dry run: ${result.planned.length} email(s) planned (cap ${result.cap}, already sent today ${result.alreadySentToday}).`);

      for (const item of result.planned) {
        const rows = await db
          .select()
          .from(outreachProspects)
          .where(eq(outreachProspects.id, item.prospectId));
        const prospect = rows[0];

        console.log('='.repeat(72));
        console.log(`Touch ${item.touchNumber} -> ${item.name} <${item.email}>`);
        console.log(`Subject: ${item.subject}`);
        if (prospect) {
          const rendered = await buildOutreachEmail(prospect, item.touchNumber);
          console.log('-'.repeat(72));
          console.log(rendered.text);
        } else {
          console.log(`(prospect ${item.prospectId} not found; body not rendered)`);
        }
      }
      console.log('='.repeat(72));
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('✗ Outreach run failed:', error);
    process.exit(1);
  });
