/**
 * One-time script to send push notification feature announcement email to Leon GM.
 *
 * Usage: npx tsx scripts/send-push-announcement.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });
import { sendFeatureAnnouncement } from '../src/lib/email';

async function main() {
  console.log('Sending push notification feature announcement to Leon GM...');

  await sendFeatureAnnouncement({
    to: 'guillermo1606@gmail.com',
    restaurantName: 'Estancia Leon',
  });

  console.log('Email sent successfully!');
}

main().catch((err) => {
  console.error('Failed to send email:', err);
  process.exit(1);
});
