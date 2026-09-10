// One-off operational script: put real contact details on the four leadership
// accounts (owner + three regionals) so they can be invited into the app.
//
// Background: these accounts existed and were correctly region-scoped, but had
// no manager_email, no manager_phone and no contact_name. Every scheduled
// email the platform sends keys off manager_email, so they received nothing
// and nobody above GM level had ever opened the product.
//
// This script does NOT set passwords. Invites go out through the normal
// password-reset flow (scripts/invite-leadership.ts) so each person chooses
// their own and we never handle plaintext.
//
// Usage:
//   npx tsx scripts/wire-leadership-accounts.ts            # dry run
//   npx tsx scripts/wire-leadership-accounts.ts --apply     # write
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

process.env.DOTENV_CONFIG_QUIET ??= 'true';
config({ path: '.env.production.local' });
config({ path: '.env.local' });

const USAGE = `Usage:
  npx tsx scripts/wire-leadership-accounts.ts [--apply]

Options:
  --apply   Perform the writes (default is a dry run that changes nothing)
  --help    Show this help`;

const sql = neon(process.env.DATABASE_URL!);

type Person = {
  slug: string;
  name: string;
  email: string;
  phone: string;
  /** New display name for the login dropdown, when the current one is wrong. */
  rename?: string;
};

const PEOPLE: Person[] = [
  {
    slug: 'owner',
    name: 'Juan Carlos Rivera',
    email: 'juancarlos.rivera@grupoestancia.com',
    phone: '+525637151754',
  },
  {
    slug: 'regional-central',
    name: 'Israel Ruvalcaba',
    email: 'israel.ruvalcaba@grupoestancia.com',
    phone: '+522227076906',
    // The account is tagged region='central' but covers the Puebla locations.
    // Israel would not recognise "Regional Central" in the login dropdown.
    rename: 'Regional Puebla',
  },
  {
    slug: 'regional-veracruz',
    name: 'Emilio Cova',
    email: 'emiliocovasanchez1985@gmail.com',
    phone: '+522213388539',
  },
  {
    slug: 'regional-queretaro',
    name: 'Mario Campos',
    email: 'mario.campos@grupoestancia.com',
    phone: '+524772600406',
  },
];

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(USAGE);
    return;
  }
  const apply = argv.includes('--apply');

  console.log(apply ? '=== APPLYING ===\n' : '=== DRY RUN (nothing will be written) ===\n');

  let failures = 0;

  for (const p of PEOPLE) {
    const current = await sql`
      select slug, name, manager_email, manager_phone, contact_name
      from restaurants where slug = ${p.slug} limit 1`;

    if (current.length === 0) {
      console.error(`  ✗ ${p.slug}: no such account`);
      failures++;
      continue;
    }

    const c = current[0];
    console.log(`  ${p.slug}`);
    console.log(`      name    ${c.name ?? '-'}  ->  ${p.rename ?? c.name}`);
    console.log(`      contact ${c.contact_name ?? '(none)'}  ->  ${p.name}`);
    console.log(`      email   ${c.manager_email ?? '(none)'}  ->  ${p.email}`);
    console.log(`      phone   ${c.manager_phone ?? '(none)'}  ->  ${p.phone}`);

    if (apply) {
      const updated = p.rename
        ? await sql`
            update restaurants
               set manager_email = ${p.email},
                   manager_phone = ${p.phone},
                   contact_name  = ${p.name},
                   name          = ${p.rename}
             where slug = ${p.slug}
            returning slug`
        : await sql`
            update restaurants
               set manager_email = ${p.email},
                   manager_phone = ${p.phone},
                   contact_name  = ${p.name}
             where slug = ${p.slug}
            returning slug`;

      if (updated.length !== 1) {
        console.error(`      ✗ expected 1 row updated, got ${updated.length}`);
        failures++;
      } else {
        console.log('      ✓ updated');
      }
    }
    console.log('');
  }

  if (!apply) {
    console.log('Nothing was written. Re-run with --apply to perform these updates.');
  } else if (failures === 0) {
    console.log('All four accounts updated.');
    console.log('Next: npx tsx scripts/invite-leadership.ts --apply');
  }

  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
