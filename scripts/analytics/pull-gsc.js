/*
 * Pull Search Console performance data for ratetapmx.com.
 *
 * Auth: reuses the .gsc-token.json (webmasters.readonly scope) that
 * was authorized against the owner's Google account. Refresh-only —
 * no interactive flow here. If the token is stale, re-auth via the
 * ddirectory/thebeatboutique script that originally minted it.
 *
 * Output: data/analytics/gsc-YYYY-MM-DD.json
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SITE_URL = process.env.GSC_SITE || 'sc-domain:ratetapmx.com';
const TOKEN_PATH = path.join(__dirname, '..', '..', '.gsc-token.json');
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'analytics');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
const wm = google.webmasters({ version: 'v3', auth: oauth2Client });

async function query(dimensions, rowLimit, days = 28) {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - days);
  const res = await wm.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      dimensions,
      rowLimit,
    },
  });
  return { rows: res.data.rows || [], startDate, endDate };
}

(async () => {
  const sites = (await wm.sites.list()).data.siteEntry || [];
  console.log('Sites available to this token:');
  sites.forEach((s) => console.log(`  ${s.permissionLevel.padEnd(18)} ${s.siteUrl}`));

  if (!sites.some((s) => s.siteUrl === SITE_URL)) {
    console.error(`\nERROR: ${SITE_URL} not visible to this token.`);
    process.exit(1);
  }

  console.log(`\nFetching GSC data for ${SITE_URL} (last 28d, 3-day lag)…`);

  const [queries, pages, totalsByDate, qp, countries, devices, appearance] = await Promise.all([
    query(['query'], 1000, 28),
    query(['page'], 1000, 28),
    query(['date'], 100, 28),
    query(['query', 'page'], 2000, 28),
    query(['country'], 50, 28),
    query(['device'], 10, 28),
    query(['searchAppearance'], 20, 28),
  ]);

  const totals = queries.rows.reduce(
    (acc, r) => ({ clicks: acc.clicks + r.clicks, impressions: acc.impressions + r.impressions }),
    { clicks: 0, impressions: 0 }
  );
  const ctr = totals.impressions ? totals.clicks / totals.impressions : 0;

  const data = {
    site: SITE_URL,
    pulled_at: new Date().toISOString(),
    dateRange: {
      start: queries.startDate.toISOString().split('T')[0],
      end: queries.endDate.toISOString().split('T')[0],
    },
    totals: { ...totals, ctr },
    byDate: totalsByDate.rows.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    queries: queries.rows.map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    pages: pages.rows.map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    queryPages: qp.rows.map((r) => ({ query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    countries: countries.rows.map((r) => ({ country: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    devices: devices.rows.map((r) => ({ device: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    searchAppearance: appearance.rows.map((r) => ({ appearance: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
  };

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().split('T')[0];
  const out = path.join(OUTPUT_DIR, `gsc-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify(data, null, 2));

  console.log(`\nSummary (${data.dateRange.start} → ${data.dateRange.end}):`);
  console.log(`  Clicks:      ${totals.clicks.toLocaleString()}`);
  console.log(`  Impressions: ${totals.impressions.toLocaleString()}`);
  console.log(`  CTR:         ${(ctr * 100).toFixed(2)}%`);
  console.log(`  Rows — queries:${queries.rows.length} pages:${pages.rows.length} combos:${qp.rows.length} countries:${countries.rows.length}`);
  console.log(`\nFull data: ${out}`);
})().catch((e) => {
  console.error('\nFATAL:', e.response?.data || e.message || e);
  process.exit(1);
});
