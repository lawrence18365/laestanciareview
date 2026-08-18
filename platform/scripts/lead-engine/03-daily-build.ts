#!/usr/bin/env npx tsx
/**
 * Daily Lead Build — orchestrator.
 *
 * Runs:
 *   1. chain-discovery (Places sweep)
 *   2. trigger-scan (poll tracked groups)
 *
 * Merges outputs into a single morning brief:
 *   data/leads/YYYY-MM-DD.csv
 *
 * Rows are sorted by priority:
 *   1. HIGH severity triggers (threshold cross / velocity spike) — send today
 *   2. MED severity triggers — send this week
 *   3. New chain discoveries (top 5 by review volume) — research + send this week
 *
 * Includes a "today_action" column with the recommended next step.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS = path.join(ROOT, 'platform', 'scripts', 'lead-engine');
const OUT_DIR = path.join(ROOT, 'data', 'leads');

const today = new Date().toISOString().split('T')[0];

function run(cmd: string) {
  console.log(`\n══ ${cmd} ══`);
  execSync(cmd, { cwd: path.join(ROOT, 'platform'), stdio: 'inherit' });
}

(async () => {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. Chain discovery
  try {
    run(`npx tsx ${SCRIPTS}/01-chain-discovery.ts`);
  } catch (e) {
    console.error('chain-discovery failed — continuing.', e);
  }

  // 2. Trigger scan
  try {
    run(`npx tsx ${SCRIPTS}/02-trigger-scan.ts`);
  } catch (e) {
    console.error('trigger-scan failed — continuing.', e);
  }

  // 3. Merge into morning brief
  const briefRows: string[] = ['priority,source,brand,severity,detail,locations,avg_rating,total_reviews,today_action'];

  // High-priority triggers first
  const triggerCsv = path.join(OUT_DIR, `triggers-${today}.csv`);
  if (fs.existsSync(triggerCsv)) {
    const triggers = fs.readFileSync(triggerCsv, 'utf8').split('\n').slice(1).filter(Boolean);
    for (const row of triggers) {
      const [severity, brand, type, detail] = parseCsvRow(row);
      const action = severity === 'HIGH'
        ? `SAME-DAY WhatsApp + voice note. Lead: "${detail.substring(0, 80)}…"`
        : 'This-week WhatsApp.';
      briefRows.push(['1', 'TRIGGER', brand, severity, csvEscape(`${type}: ${detail}`), '', '', '', csvEscape(action)].join(','));
    }
  }

  // Chain discoveries (top 5 by review volume)
  const chainCsv = path.join(OUT_DIR, `chain-discovery-${today}.csv`);
  if (fs.existsSync(chainCsv)) {
    const chains = fs.readFileSync(chainCsv, 'utf8').split('\n').slice(1).filter(Boolean);
    const parsed = chains.map((r) => parseCsvRow(r));
    parsed.sort((a, b) => parseInt(b[3] || '0', 10) - parseInt(a[3] || '0', 10));
    for (const row of parsed.slice(0, 5)) {
      const [brand, locations, avgRating, totalReviews] = row;
      briefRows.push([
        '2', 'DISCOVERY', brand, 'MED',
        csvEscape(`New chain: ${locations} locations found in sweep`),
        locations, avgRating, totalReviews,
        csvEscape('Verify on group website + IG, enrich owner contact, add to active prospect list.'),
      ].join(','));
    }
  }

  // Write morning brief
  const briefPath = path.join(OUT_DIR, `${today}.csv`);
  fs.writeFileSync(briefPath, briefRows.join('\n'));

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`MORNING BRIEF — ${today}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Wrote ${briefRows.length - 1} action rows to: ${briefPath}`);
  console.log('');
  console.log('Order of operations at 9:30 a.m.:');
  console.log('  1. Read this CSV');
  console.log('  2. Top HIGH-severity trigger rows → record 60-sec voice note + send WhatsApp at 10:15');
  console.log('  3. MED triggers → queue for follow-up batch');
  console.log('  4. DISCOVERY rows → research on group website, then enrich (re-run enrich-groups.ts with new brand added)');
})();

function parseCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"' && row[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function csvEscape(s: string): string {
  if (s.includes('"') || s.includes(',') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
