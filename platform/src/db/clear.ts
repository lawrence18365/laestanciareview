import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { reviews, staff, restaurants } from './schema';

async function clear() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);
  await db.delete(reviews);
  await db.delete(staff);
  await db.delete(restaurants);
  console.log('Cleared all tables.');
}

clear().catch((err) => {
  console.error('Clear failed:', err);
  process.exit(1);
});
