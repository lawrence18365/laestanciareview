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

  // Check recent alert failures across all restaurants
  console.log('=== Recent alert failures ===\n');
  const failures = await db
    .select({
      id: reviews.id,
      restaurantId: reviews.restaurantId,
      rating: reviews.rating,
      alertError: reviews.alertError,
      alertSentAt: reviews.alertSentAt,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(isNotNull(reviews.alertError))
    .orderBy(desc(reviews.createdAt))
    .limit(10);

  if (failures.length === 0) {
    console.log('  No alert failures recorded (or reviews predate tracking)');
  } else {
    for (const f of failures) {
      const rest = allRestaurants.find(r => r.id === f.restaurantId);
      console.log(`  Review #${f.id}: ★${f.rating} | ${rest?.name ?? 'unknown'} | ${f.createdAt}`);
      console.log(`    Error: ${f.alertError}`);
    }
  }

  // Check recent non-Google reviews without alert tracking (pre-migration)
  console.log('\n=== Last 10 intercepted reviews (alert status) ===\n');
  const recentIntercepted = await db
    .select({
      id: reviews.id,
      restaurantId: reviews.restaurantId,
      rating: reviews.rating,
      feedback: reviews.feedback,
      sentToGoogle: reviews.sentToGoogle,
      alertSentAt: reviews.alertSentAt,
      alertError: reviews.alertError,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .where(eq(reviews.sentToGoogle, false))
    .orderBy(desc(reviews.createdAt))
    .limit(10);

  for (const r of recentIntercepted) {
    const rest = allRestaurants.find(x => x.id === r.restaurantId);
    const alertStatus = r.alertSentAt ? '✅ sent' : r.alertError ? `❌ ${r.alertError}` : '⚪ no tracking';
    console.log(`  #${r.id}: ★${r.rating} | ${rest?.name ?? 'unknown'} | alert: ${alertStatus} | ${r.createdAt}`);
  }

  console.log('\n=== Environment check ===');
  console.log(`RESEND_API_KEY: ${process.env.RESEND_API_KEY ? 'SET' : 'MISSING'}`);
  console.log(`TELNYX_API_KEY: ${process.env.TELNYX_API_KEY ? 'SET' : 'MISSING'}`);
  console.log(`TELNYX_MESSAGING_PROFILE_ID: ${process.env.TELNYX_MESSAGING_PROFILE_ID ? 'SET' : 'MISSING'}`);
  console.log(`TWILIO_ACCOUNT_SID: ${process.env.TWILIO_ACCOUNT_SID ? 'SET' : 'MISSING'}`);
  console.log(`TWILIO_AUTH_TOKEN: ${process.env.TWILIO_AUTH_TOKEN ? 'SET' : 'MISSING'}`);
  console.log(`TWILIO_WHATSAPP_FROM: ${process.env.TWILIO_WHATSAPP_FROM ? 'SET' : 'MISSING'}`);
}

check().catch((err) => {
  console.error('Check failed:', err);
  process.exit(1);
});
