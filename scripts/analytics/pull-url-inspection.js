/*
 * Run URL Inspection API across every URL listed in sitemap.xml.
 * Tells us per-URL: indexed Y/N, coverage state, last crawl, canonical, mobile usability.
 * Throttled to ~1 req/sec to stay friendly with the API.
 *
 * Output: data/analytics/url-inspection-YYYY-MM-DD.json
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const SITE_URL = process.env.GSC_SITE || 'sc-domain:ratetapmx.com';
const SITEMAP = path.join(__dirname, '..', '..', 'sitemap.xml');
const TOKEN_PATH = path.join(__dirname, '..', '..', '.gsc-token.json');
const OUTPUT_DIR = path.join(__dirname, '..', '..', 'data', 'analytics');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
oauth2Client.setCredentials(JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')));
const sc = google.searchconsole({ version: 'v1', auth: oauth2Client });

function extractUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function inspect(url) {
  const res = await sc.urlInspection.index.inspect({
    requestBody: { inspectionUrl: url, siteUrl: SITE_URL },
  });
  const r = res.data.inspectionResult || {};
  return {
    url,
    verdict: r.indexStatusResult?.verdict,
    coverageState: r.indexStatusResult?.coverageState,
    robotsTxtState: r.indexStatusResult?.robotsTxtState,
    indexingState: r.indexStatusResult?.indexingState,
    lastCrawlTime: r.indexStatusResult?.lastCrawlTime,
    pageFetchState: r.indexStatusResult?.pageFetchState,
    googleCanonical: r.indexStatusResult?.googleCanonical,
    userCanonical: r.indexStatusResult?.userCanonical,
    mobileVerdict: r.mobileUsabilityResult?.verdict,
    referringUrls: (r.indexStatusResult?.referringUrls || []).length,
  };
}

(async () => {
  const xml = fs.readFileSync(SITEMAP, 'utf8');
  const urls = [...new Set(extractUrls(xml))];
  console.log(`Found ${urls.length} URLs in sitemap.xml`);

  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    try {
      const r = await inspect(u);
      results.push(r);
      console.log(`  [${i + 1}/${urls.length}] ${r.verdict?.padEnd(10) || 'n/a'.padEnd(10)} ${r.coverageState || ''}  ${u}`);
    } catch (e) {
      results.push({ url: u, error: e.message });
      console.log(`  [${i + 1}/${urls.length}] ERROR ${u} :: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  const summary = results.reduce((acc, r) => {
    const v = r.verdict || (r.error ? 'ERROR' : 'UNKNOWN');
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().split('T')[0];
  const out = path.join(OUTPUT_DIR, `url-inspection-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ site: SITE_URL, pulled_at: new Date().toISOString(), summary, results }, null, 2));

  console.log('\nVerdict summary:');
  Object.entries(summary).forEach(([k, v]) => console.log(`  ${k.padEnd(12)} ${v}`));
  console.log(`\nFull data: ${out}`);
})().catch((e) => {
  console.error('FATAL:', e.response?.data || e.message || e);
  process.exit(1);
});
