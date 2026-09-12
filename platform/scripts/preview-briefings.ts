// Read-only: renders the owner and regional briefings against live data and
// writes them to /tmp as HTML. Sends nothing. Run before enabling the cron.
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
process.env.DOTENV_CONFIG_QUIET ??= 'true';
config({ path: '.env.production.local' });
config({ path: '.env.local' });
process.env.SMTP_USER = ''; process.env.SMTP_PASS = ''; // force skip, never send

async function main() {
  const { getWeeklySignals, getGuestSignals, getServiceSignals, getUpcomingBirthdays, lastCompleteWeekStart } =
    await import('../src/lib/weekly-signal');
  const { signalLabel } = await import('../src/lib/location-signal');
  const { getGoogleRatingTrendBatch } = await import('../src/lib/google-places');

  const weekStart = lastCompleteWeekStart();
  const signals = await getWeeklySignals(weekStart);
  const guestStats = await getGuestSignals(weekStart);
  const serviceStats = await getServiceSignals(weekStart);
  const trends = await getGoogleRatingTrendBatch(signals.map((s) => s.restaurantId));

  const toLoc = (s: (typeof signals)[number]) => {
    const g = guestStats.get(s.restaurantId);
    const service = serviceStats.get(s.restaurantId);
    const t = trends[s.restaurantId] ?? null;
    return {
      name: s.name,
      totalGuests: g?.totalGuests ?? 0,
      newGuestsThisWeek: g?.newThisWeek ?? 0,
      returningGuests: g?.returningGuests ?? 0,
      courtesiesThisWeek: g?.courtesiesThisWeek ?? 0,
      scansThisWeek: s.scansThisWeek,
      scansLastWeek: s.scansLastWeek,
      staffAskingThisWeek: s.staffAskingThisWeek,
      staffAskingLastWeek: s.staffAskingLastWeek,
      gmActiveDays: s.gmActiveDays,
      complaintsThisWeek: service?.complaintsThisWeek ?? 0,
      overdueComplaints: service?.overdueOpen ?? 0,
      currentRating: t?.currentRating ?? null,
      baselineRating: t?.baselineRating ?? null,
      signalSummary: s.signal.summary,
      signalLabel: signalLabel(s.signal.signal),
      actionable: s.signal.actionable,
    };
  };

  console.log(`Week: ${weekStart.toDateString()}`);
  console.log(`Locations: ${signals.length}`);
  console.log(`Flagged for a call: ${signals.filter((s) => s.signal.actionable).map((s) => s.name).join(', ') || 'none'}`);

  const guestTotal = signals.reduce((n, s) => n + (guestStats.get(s.restaurantId)?.totalGuests ?? 0), 0);
  const returning = signals.reduce((n, s) => n + (guestStats.get(s.restaurantId)?.returningGuests ?? 0), 0);
  console.log(`Owner headline: ${guestTotal} guests on file, ${returning} returned`);

  for (const region of ['central', 'veracruz', 'queretaro']) {
    const scoped = signals.filter((s) => s.region === region);
    const bdays = await getUpcomingBirthdays(new Date(), region);
    console.log(`  region ${region}: ${scoped.length} locations, ${bdays.length} birthdays in window`);
  }
  console.log('\nRendering HTML (nothing is sent — SMTP creds are blanked)...');

  const { sendOwnerBriefing, sendRegionalBriefing } = await import('../src/lib/email');
  const o = await sendOwnerBriefing({ to: 'preview@example.com', weekStart, locations: signals.map(toLoc), dashboardUrl: 'https://app.ratetapmx.com/overview' });
  console.log('owner send result:', JSON.stringify(o));
  const vcr = signals.filter((s) => s.region === 'veracruz');
  const bd = await getUpcomingBirthdays(new Date(), 'veracruz');
  const r = await sendRegionalBriefing({ to: 'preview@example.com', regionName: 'Regional Veracruz', weekStart, locations: vcr.map(toLoc), birthdays: bd, dashboardUrl: 'https://app.ratetapmx.com/overview' });
  console.log('regional send result:', JSON.stringify(r));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
