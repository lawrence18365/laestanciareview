/**
 * Migration: Add regional manager accounts and assign regions to restaurants.
 * Also adds Google Place ID for Estancia León.
 *
 * Usage:
 *   1. First push the schema: npx drizzle-kit push
 *   2. Then run this: npx tsx src/db/migrate-regions.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { restaurants } from './schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '../lib/auth';

// Region assignments by slug
const regionMap: Record<string, string> = {
  'estancia-queretaro': 'queretaro',
  'steakcompany-queretaro': 'queretaro',
  'estancia-veracruz': 'veracruz',
  'estancia-xalapa': 'veracruz',
  'harbors-veracruz': 'veracruz',
  'estancia-angelopolis': 'central',
  'estancia-juarez': 'central',
  'estancia-leon': 'leon',
  'la-silla-juarez': 'central',
  'la-silla-huexotitla': 'central',
  'harbors-angelopolis': 'central',
  'regio-norte': 'central',
};

// Regional manager accounts
const regionalAccounts = [
  { name: 'Regional Querétaro', slug: 'regional-queretaro', region: 'queretaro' },
  { name: 'Regional Veracruz', slug: 'regional-veracruz', region: 'veracruz' },
  { name: 'Regional Central', slug: 'regional-central', region: 'central' },
  { name: 'Regional León', slug: 'regional-leon', region: 'leon' },
];

async function migrate() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const defaultPasswordHash = await hashPassword('ratetap2024');

  console.log('Assigning regions to restaurants...');

  // Update regions for all restaurants
  for (const [slug, region] of Object.entries(regionMap)) {
    await db
      .update(restaurants)
      .set({ region })
      .where(eq(restaurants.slug, slug));
    console.log(`  ${slug} → ${region}`);
  }

  // Update Estancia León's Google Place ID
  await db
    .update(restaurants)
    .set({ googlePlaceId: 'ChIJM1x5LlW-K4QRrPy1SMe-04E' })
    .where(eq(restaurants.slug, 'estancia-leon'));
  console.log('  estancia-leon → added Google Place ID');

  console.log('\nCreating regional manager accounts...');

  // Create regional manager accounts
  for (const r of regionalAccounts) {
    const [regional] = await db
      .insert(restaurants)
      .values({
        name: r.name,
        slug: r.slug,
        googleThreshold: 4,
        adminPasswordHash: defaultPasswordHash,
        isRegional: true,
        region: r.region,
        managerEmail: 'lawrencebrennan@gmail.com',
        alertPreference: 'all',
      })
      .onConflictDoUpdate({
        target: restaurants.slug,
        set: {
          name: r.name,
          adminPasswordHash: defaultPasswordHash,
          isRegional: true,
          region: r.region,
        },
      })
      .returning();
    console.log(`  ${regional.name} (id=${regional.id}, region=${r.region})`);
  }

  console.log('\nMigration complete!');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
