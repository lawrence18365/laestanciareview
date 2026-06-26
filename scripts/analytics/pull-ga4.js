/*
 * Pull GA4 Data API + Realtime report for ratetapmx.com.
 * Auto-discovers the property by name match; caches to .ga4-property.json.
 * Auth: .ga4-token.json (analytics.readonly scope).
 *
 * Output: data/analytics/ga4-YYYY-MM-DD.json
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '..', '..', '.ga4-token.json');
const PROP_PATH = path.join(__dirname, '..', '..', '.ga4-property.json');
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'analytics');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

if (!fs.existsSync(TOKEN_PATH)) {
  console.error(`No ${TOKEN_PATH}.`);
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));

const admin = google.analyticsadmin({ version: 'v1beta', auth: oauth2Client });
const data = google.analyticsdata({ version: 'v1beta', auth: oauth2Client });

async function resolveProperty() {
  if (process.env.GA4_PROPERTY) return process.env.GA4_PROPERTY;
  if (fs.existsSync(PROP_PATH)) {
    return JSON.parse(fs.readFileSync(PROP_PATH, 'utf8')).property;
  }
  console.log('Discovering GA4 properties via Admin API…');
  const res = await admin.accountSummaries.list({ pageSize: 200 });
  const summaries = res.data.accountSummaries || [];
  let chosen = null;
  for (const acc of summaries) {
    for (const p of acc.propertySummaries || []) {
      console.log(`  ${p.property}  ${p.displayName}  (acct: ${acc.displayName})`);
      if (/ratetap|estancia/i.test(p.displayName) || /ratetap|estancia/i.test(acc.displayName)) {
        chosen = p.property;
      }
    }
  }
  if (!chosen) throw new Error('No matching property found. Set GA4_PROPERTY env to override.');
  fs.writeFileSync(PROP_PATH, JSON.stringify({ property: chosen }, null, 2));
  console.log(`Cached property: ${chosen}`);
  return chosen;
}

async function runReport(property, dimensions, metrics, days = 28, limit = 100) {
  const end = new Date();
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(end.getDate() - days);
  const fmt = (d) => d.toISOString().split('T')[0];
  const res = await data.properties.runReport({
    property,
    requestBody: {
      dateRanges: [{ startDate: fmt(start), endDate: fmt(end) }],
      dimensions: dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      limit,
      orderBys: metrics.length ? [{ metric: { metricName: metrics[0] }, desc: true }] : undefined,
    },
  });
  return {
    range: { start: fmt(start), end: fmt(end) },
    rows: (res.data.rows || []).map((r) => {
      const out = {};
      dimensions.forEach((d, i) => (out[d] = r.dimensionValues[i].value));
      metrics.forEach((m, i) => (out[m] = Number(r.metricValues[i].value)));
      return out;
    }),
    totals: (res.data.totals?.[0]?.metricValues || []).map((v, i) => ({ [metrics[i]]: Number(v.value) })),
  };
}

(async () => {
  const property = await resolveProperty();
  console.log(`\nProperty: ${property}\n`);

  const M = ['sessions', 'totalUsers', 'screenPageViews', 'engagedSessions', 'eventCount', 'conversions'];

  const [overall, byDate, bySource, byChannel, byCountry, byDevice, byPage, byEvent, byLanding, byCity] = await Promise.all([
    runReport(property, [], M, 28, 1),
    runReport(property, ['date'], ['sessions', 'totalUsers', 'screenPageViews', 'eventCount'], 28, 100),
    runReport(property, ['sessionSource', 'sessionMedium'], ['sessions', 'totalUsers', 'engagedSessions'], 28, 50),
    runReport(property, ['sessionDefaultChannelGroup'], ['sessions', 'totalUsers', 'engagedSessions'], 28, 20),
    runReport(property, ['country'], ['sessions', 'totalUsers'], 28, 30),
    runReport(property, ['deviceCategory'], ['sessions', 'totalUsers', 'engagedSessions'], 28, 10),
    runReport(property, ['pagePath'], ['screenPageViews', 'totalUsers', 'eventCount'], 28, 50),
    runReport(property, ['eventName'], ['eventCount', 'totalUsers'], 28, 50),
    runReport(property, ['landingPage'], ['sessions', 'engagedSessions', 'totalUsers'], 28, 30),
    runReport(property, ['city'], ['sessions', 'totalUsers'], 28, 30),
  ]);

  let realtime = null;
  try {
    const rt = await data.properties.runRealtimeReport({
      property,
      requestBody: {
        metrics: [{ name: 'activeUsers' }],
        dimensions: [{ name: 'unifiedScreenName' }],
        limit: 20,
      },
    });
    realtime = {
      activeUsers: Number(rt.data.totals?.[0]?.metricValues?.[0]?.value || 0),
      topScreens: (rt.data.rows || []).map((r) => ({
        screen: r.dimensionValues[0].value,
        users: Number(r.metricValues[0].value),
      })),
    };
  } catch (e) {
    realtime = { error: e.message };
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().split('T')[0];
  const out = path.join(OUTPUT_DIR, `ga4-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({
    property, pulled_at: new Date().toISOString(), range: overall.range,
    overall: overall.totals, byDate: byDate.rows, bySource: bySource.rows, byChannel: byChannel.rows,
    byCountry: byCountry.rows, byDevice: byDevice.rows, byPage: byPage.rows, byEvent: byEvent.rows,
    byLanding: byLanding.rows, byCity: byCity.rows, realtime,
  }, null, 2));

  console.log(`Range: ${overall.range.start} → ${overall.range.end}`);
  console.log('Totals (28d):');
  overall.totals.forEach((t) => {
    const [k, v] = Object.entries(t)[0];
    console.log(`  ${k.padEnd(20)} ${v.toLocaleString()}`);
  });
  console.log('\nTop channels:');
  byChannel.rows.slice(0, 8).forEach((r) =>
    console.log(`  ${String(r.sessions).padStart(5)} sess  ${String(r.totalUsers).padStart(5)} users  ${r.sessionDefaultChannelGroup}`)
  );
  console.log('\nTop pages:');
  byPage.rows.slice(0, 10).forEach((r) =>
    console.log(`  ${String(r.screenPageViews).padStart(5)} views  ${r.pagePath}`)
  );
  console.log('\nTop events:');
  byEvent.rows.slice(0, 10).forEach((r) =>
    console.log(`  ${String(r.eventCount).padStart(6)} ${r.eventName}`)
  );
  console.log(`\nRealtime activeUsers: ${realtime?.activeUsers ?? 'n/a'}`);
  console.log(`\nFull data: ${out}`);
})().catch((e) => {
  console.error('FATAL:', e.response?.data || e.message || e);
  process.exit(1);
});
