import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { restaurants, staff, reviews } from './schema';
import { eq, and, sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';

interface RawReview {
  timestamp: string;
  staffCode: string;
  staffName: string;
  rating: number;
}

interface FeedbackEntry {
  timestamp: string;
  rating: number;
  staffCode: string;
  staffName: string;
  customerName: string | null;
  customerEmail: string | null;
  feedback: string | null;
}

async function migrateLeon() {
  const sqlClient = neon(process.env.DATABASE_URL!);
  const db = drizzle(sqlClient);

  // Load extracted data
  const dataPath = join(__dirname, 'leon-data.json');
  const data: { reviews: RawReview[]; feedback: FeedbackEntry[] } = JSON.parse(
    readFileSync(dataPath, 'utf-8'),
  );

  console.log(`Loaded ${data.reviews.length} reviews and ${data.feedback.length} feedback entries\n`);

  // Find estancia-leon restaurant
  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.slug, 'estancia-leon'));

  if (!restaurant) {
    console.error('Restaurant estancia-leon not found. Run seed first.');
    process.exit(1);
  }
  console.log(`Found restaurant: ${restaurant.name} (id=${restaurant.id})`);

  // Load staff to map codes → IDs
  const staffRows = await db
    .select()
    .from(staff)
    .where(eq(staff.restaurantId, restaurant.id));

  const staffByCode: Record<string, number> = {};
  for (const s of staffRows) {
    staffByCode[s.code] = s.id;
  }
  console.log(`Found ${staffRows.length} staff members\n`);

  // Build a lookup for feedback entries by staffCode + close timestamp
  // so we can enrich the raw reviews with customer details
  const feedbackMap = new Map<string, FeedbackEntry>();
  for (const fb of data.feedback) {
    // Key: staffCode + timestamp rounded to nearest minute
    const ts = new Date(fb.timestamp);
    const key = `${fb.staffCode}|${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}-${ts.getHours()}-${ts.getMinutes()}`;
    feedbackMap.set(key, fb);
  }

  // Delete existing reviews for Leon (clean migration)
  const deleted = await db
    .delete(reviews)
    .where(eq(reviews.restaurantId, restaurant.id))
    .returning({ id: reviews.id });
  if (deleted.length > 0) {
    console.log(`Deleted ${deleted.length} existing reviews for clean migration`);
  }

  // Import all raw reviews, enriching with feedback where we find a match
  let imported = 0;
  let enriched = 0;
  let skipped = 0;
  const matchedFeedbackKeys = new Set<string>();

  // Batch inserts for performance (50 at a time)
  const BATCH_SIZE = 50;
  const allValues: Array<{
    restaurantId: number;
    staffId: number | null;
    staffCode: string;
    staffName: string;
    rating: number;
    customerName: string | null;
    customerEmail: string | null;
    feedback: string | null;
    sentToGoogle: boolean;
    status: 'new' | 'reviewed' | 'resolved';
    createdAt: Date;
  }> = [];

  for (const review of data.reviews) {
    const staffId = staffByCode[review.staffCode] ?? null;
    if (!staffId) {
      skipped++;
      continue;
    }

    const ts = new Date(review.timestamp);
    const feedbackKey = `${review.staffCode}|${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}-${ts.getHours()}-${ts.getMinutes()}`;
    const fb = feedbackMap.get(feedbackKey);

    let customerName: string | null = null;
    let customerEmail: string | null = null;
    let feedbackText: string | null = null;
    let sentToGoogle = false;

    if (fb && !matchedFeedbackKeys.has(feedbackKey)) {
      customerName = fb.customerName && fb.customerName !== 'Anonymous' ? fb.customerName : null;
      customerEmail = fb.customerEmail;
      feedbackText = fb.feedback;
      matchedFeedbackKeys.add(feedbackKey);
      enriched++;
    }

    // Ratings at or above threshold (5) were sent to Google
    if (review.rating >= 5) {
      sentToGoogle = true;
    }

    allValues.push({
      restaurantId: restaurant.id,
      staffId,
      staffCode: review.staffCode,
      staffName: review.staffName,
      rating: review.rating,
      customerName,
      customerEmail,
      feedback: feedbackText,
      sentToGoogle,
      status: 'reviewed',
      createdAt: ts,
    });
  }

  // Insert remaining unmatched feedback entries as separate reviews
  for (const fb of data.feedback) {
    const ts = new Date(fb.timestamp);
    const feedbackKey = `${fb.staffCode}|${ts.getFullYear()}-${ts.getMonth()}-${ts.getDate()}-${ts.getHours()}-${ts.getMinutes()}`;
    if (matchedFeedbackKeys.has(feedbackKey)) continue;

    const staffId = staffByCode[fb.staffCode] ?? null;
    if (!staffId) continue;

    allValues.push({
      restaurantId: restaurant.id,
      staffId,
      staffCode: fb.staffCode,
      staffName: fb.staffName,
      rating: fb.rating,
      customerName: fb.customerName && fb.customerName !== 'Anonymous' ? fb.customerName : null,
      customerEmail: fb.customerEmail,
      feedback: fb.feedback,
      sentToGoogle: false,
      status: 'reviewed',
      createdAt: ts,
    });
    enriched++;
  }

  // Batch insert
  for (let i = 0; i < allValues.length; i += BATCH_SIZE) {
    const batch = allValues.slice(i, i + BATCH_SIZE);
    await db.insert(reviews).values(batch);
    imported += batch.length;
    if (imported % 200 === 0 || i + BATCH_SIZE >= allValues.length) {
      console.log(`  Imported ${imported}/${allValues.length} reviews...`);
    }
  }

  console.log(`\n✅ Migration complete for Estancia Leon:`);
  console.log(`   ${imported} total reviews imported`);
  console.log(`   ${enriched} enriched with customer feedback`);
  console.log(`   ${skipped} skipped (unknown staff code)`);
  console.log(`   Date range: ${data.reviews[0]?.timestamp} → ${data.reviews[data.reviews.length - 1]?.timestamp}`);
}

migrateLeon().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
