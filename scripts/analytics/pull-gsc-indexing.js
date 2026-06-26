/*
 * Pull GSC sitemap status + 90-day page-level coverage for ratetapmx.com.
 * Output: data/analytics/gsc-indexing-YYYY-MM-DD.json
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

async function query(dimensions, rowLimit, days) {
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
  console.log(`Site: ${SITE_URL}\n`);

  console.log('— Sitemaps —');
  const sm = await wm.sitemaps.list({ siteUrl: SITE_URL });
  const sitemaps = sm.data.sitemap || [];
  const sitemapSummary = sitemaps.map((s) => ({
    path: s.path,
    lastSubmitted: s.lastSubmitted,
    lastDownloaded: s.lastDownloaded,
    isSitemapsIndex: s.isSitemapsIndex,
    errors: s.errors,
    warnings: s.warnings,
    contents: (s.contents || []).map((c) => ({ type: c.type, submitted: c.submitted, indexed: c.indexed })),
  }));
  sitemapSummary.forEach((s) => {
    console.log(`  ${s.path}  (errors=${s.errors} warnings=${s.warnings})`);
    s.contents.forEach((c) => console.log(`    ${c.type}: submitted=${c.submitted}  indexed=${c.indexed}`));
  });

  console.log('\n— Pages with impressions in last 90 days —');
  const pages90 = await query(['page'], 5000, 90);
  console.log(`  ${pages90.rows.length} pages`);

  console.log('\n— Queries in last 90 days —');
  const q90 = await query(['query'], 1000, 90);
  console.log(`  ${q90.rows.length} queries`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().split('T')[0];
  const out = path.join(OUTPUT_DIR, `gsc-indexing-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({
    site: SITE_URL,
    pulled_at: new Date().toISOString(),
    sitemaps: sitemapSummary,
    pages_90d: pages90.rows.map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
    queries_90d: q90.rows.map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })),
  }, null, 2));
  console.log(`\nFull data: ${out}`);
})().catch((e) => {
  console.error('ERR:', e.response?.data || e.message);
  process.exit(1);
});
