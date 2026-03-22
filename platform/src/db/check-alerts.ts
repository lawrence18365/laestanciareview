/**
 * Quick diagnostic: check alert configuration for all restaurants.
 * Usage: npx tsx src/db/check-alerts.ts
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { restaurants, reviews } from './schema';
import { eq, desc, and, isNotNull } from 'drizzle-orm';

async function check() {
  const sql = neon(process.env.DATABASE_URL!);
  const db = drizzle(sql);

  console.log('=== Alert Configuration for all restaurants ===\n');

  const allRestaurants = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      managerEmail: restaurants.managerEmail,
      managerPhone: restaurants.managerPhone,
      alertPreference: restaurants.alertPreference,
      smsAlerts: restaurants.smsAlerts,
      whatsappAlerts: restaurants.whatsappAlerts,
      googleReviewUrl: restaurants.googleReviewUrl,
      googleThreshold: restaurants.googleThreshold,
      isOwner: restaurants.isOwner,
      isRegional: restaurants.isRegional,
    })
    .from(restaurants)
    .where(
      and(
        eq(restaurants.isOwner, false),
        eq(restaurants.isRegional, false),
      ),
    );

  for (const r of allRestaurants) {
    const hasEmail = !!r.managerEmail;
    const hasSMS = !!r.smsAlerts && !!r.managerPhone;
    const hasWhatsApp = !!r.whatsappAlerts && !!r.managerPhone;
    const alertsEnabled = r.alertPreference !== 'off';
    const hasGoogleUrl = !!r.googleReviewUrl;

    const issues: string[] = [];
    if (!hasEmail) issues.push('NO EMAIL');
    if (!alertsEnabled) issues.push('ALERTS OFF');
    if (!hasGoogleUrl) issues.push('NO GOOGLE URL (all ratings → feedback)');

    const status = issues.length === 0 ? '✅' : '⚠️';

    console.log(`${status} ${r.name} (${r.slug})`);
    console.log(`   Email: ${r.managerEmail || 'NULL'}`);
    console.log(`   Phone: ${r.managerPhone || 'NULL'} | SMS: ${r.smsAlerts ? 'ON' : 'OFF'} | WhatsApp: ${r.whatsappAlerts ? 'ON' : 'OFF'}`);
    console.log(`   Alert pref: ${r.alertPreference || 'NULL'} | Threshold: ${r.googleThreshold}`);
    console.log(`   Google URL: ${hasGoogleUrl ? 'SET' : 'NULL'}`);
    if (issues.length) console.log(`   ⚠️  ${issues.join(' | ')}`);
    console.log();
  }

  // Check recent reviews for La Silla Juárez specifically
  console.log('=== Last 5 La Silla Juárez reviews ===\n');
  const laSilla = allRestaurants.find(r => r.slug === 'la-silla-juarez');
  if (laSilla) {
    const recentReviews = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        feedback: reviews.feedback,
        customerName: reviews.customerName,
        sentToGoogle: reviews.sentToGoogle,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .where(eq(reviews.restaurantId, laSilla.id))
      .orderBy(desc(reviews.createdAt))
      .limit(5);

    if (recentReviews.length === 0) {
      console.log('  No reviews found for La Silla Juárez');
    } else {
      for (const r of recentReviews) {
        const hasFeedback = !!r.feedback;
        console.log(`  Review #${r.id}: ★${r.rating} | feedback: ${hasFeedback ? 'YES' : 'NO'} | google: ${r.sentToGoogle ? 'YES' : 'NO'} | ${r.createdAt}`);
        if (hasFeedback) console.log(`    "${r.feedback?.slice(0, 80)}..."`);
      }
    }
  }

  console.log('\n=== Environment check ===');
  console.log(`RESEND_API_KEY: ${process.env.RESEND_API_KEY ? 'SET' : 'MISSING'}`);
  console.log(`TELNYX_API_KEY: ${process.env.TELNYX_API_KEY ? 'SET' : 'MISSING'}`);
  console.log(`TELNYX_MESSAGING_PROFILE_ID: ${process.env.TELNYX_MESSAGING_PROFILE_ID ? 'SET' : 'MISSING'}`);
  console.log(`WHATSAPP_TOKEN: ${process.env.WHATSAPP_TOKEN ? 'SET' : 'MISSING'}`);
  console.log(`WHATSAPP_PHONE_ID: ${process.env.WHATSAPP_PHONE_ID ? 'SET' : 'MISSING'}`);
}

check().catch((err) => {
  console.error('Check failed:', err);
  process.exit(1);
});
