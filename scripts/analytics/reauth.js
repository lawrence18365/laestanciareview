/*
 * One-time re-auth for GA4 + GSC pulls.
 *
 * The existing tokens (.ga4-token.json / .gsc-token.json) use Google's
 * deprecated OOB flow and their refresh tokens were revoked (testing-mode
 * 7-day expiry). This runs a loopback OAuth flow once, requests both the
 * Analytics and Search Console scopes in a single consent, and writes a
 * fresh token (with refresh_token) to BOTH files.
 *
 * Run:  NODE_PATH=/Users/lawrence/Desktop/ddirectory/node_modules node scripts/analytics/reauth.js
 * Then: re-run pull-ga4.js / pull-gsc.js / pull-url-inspection.js as usual.
 *
 * NOTE: to stop the 7-day refresh-token expiry recurring, set the OAuth
 * consent screen to "In production" (not "Testing") in Google Cloud Console.
 */
const { google } = require('googleapis');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { exec } = require('child_process');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const PORT = 4115;
const REDIRECT_URI = `http://localhost:${PORT}`;
const ROOT = path.join(__dirname, '..', '..');

const SCOPES = [
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/analytics.edit',
  'https://www.googleapis.com/auth/webmasters.readonly',
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a fresh refresh_token
  scope: SCOPES,
});

console.log('\nOpening browser for Google consent…');
console.log('If it does not open, paste this URL:\n\n' + authUrl + '\n');
exec(`open "${authUrl}"`); // macOS

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, REDIRECT_URI);
    const code = url.searchParams.get('code');
    if (!code) { res.end('No code in request.'); return; }

    const { tokens } = await oauth2Client.getToken(code);
    fs.writeFileSync(path.join(ROOT, '.ga4-token.json'), JSON.stringify(tokens, null, 2));
    fs.writeFileSync(path.join(ROOT, '.gsc-token.json'), JSON.stringify(tokens, null, 2));

    res.end('✅ RateTap analytics re-authed. You can close this tab and return to the terminal.');
    console.log('\n✅ Wrote .ga4-token.json and .gsc-token.json');
    console.log('   has refresh_token:', !!tokens.refresh_token);
    console.log('\nNow run:');
    console.log('  NODE_PATH=/Users/lawrence/Desktop/ddirectory/node_modules node scripts/analytics/pull-ga4.js');
    console.log('  NODE_PATH=/Users/lawrence/Desktop/ddirectory/node_modules node scripts/analytics/pull-gsc.js');
    console.log('  NODE_PATH=/Users/lawrence/Desktop/ddirectory/node_modules node scripts/analytics/pull-url-inspection.js\n');
    server.close();
    process.exit(0);
  } catch (e) {
    res.end('Error: ' + (e.message || e));
    console.error('FATAL:', e.response?.data || e.message || e);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => console.log(`Waiting for consent on ${REDIRECT_URI} …`));
