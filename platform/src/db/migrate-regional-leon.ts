/**
 * Migration: Create regional-leon manager account.
 *
 * Usage:  npx tsx src/db/migrate-regional-leon.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { restaurants } from './schema';
import { hashPassword } from '../lib/auth';

async function migrate() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  const defaultPasswordHash = await hashPassword('ratetap2024');

  console.log('Creating regional-leon manager account...');

  const [regional] = await db
    .insert(restaurants)
    .values({
      name: 'Regional León',
      slug: 'regional-leon',
      googleThreshold: 4,
      adminPasswordHash: defaultPasswordHash,
      isRegional: true,
      region: 'leon',
      managerEmail: 'lawrencebrennan@gmail.com',
      alertPreference: 'all',
    })
    .onConflictDoUpdate({
      target: restaurants.slug,
      set: {
        name: 'Regional León',
        adminPasswordHash: defaultPasswordHash,
        isRegional: true,
        region: 'leon',
      },
    })
    .returning();

  console.log(`  Regional León (id=${regional.id}, region=leon)`);
  console.log('\nDone! Login: regional-leon / ratetap2024');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
