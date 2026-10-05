/**
 * Run: cd platform && npx tsx scripts/chef-weekly-export.ts [--week-start YYYY-MM-DD]
 *
 * A human must review the uncertain-row count before sending. Sending is manual:
 * this script never emails or uploads the export.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';
import { analyzeFeedbackText } from '../src/lib/review-classification';
import { TZ, UNIT_IDS, UNIT_NAMES, computeWeekWindow, parseArgs, redactComment, toCsv, localIso, type WeekWindow } from '../src/lib/chef-weekly-export';
export { computeWeekWindow, parseArgs, redactComment, csvField, toCsv, type WeekWindow } from '../src/lib/chef-weekly-export';
type CsvRow = Parameters<typeof toCsv>[0][number];
const CSV_HEADERS = ['unidad', 'fecha', 'calificacion', 'mesero', 'comentario', 'senal_comida'] as const;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const ENV_PATH = path.resolve(SCRIPT_DIR, '../.env.local');
const OUTPUT_DIR = path.join(REPO_ROOT, 'data/chef-exports');
type DbRow = {
  restaurant_id: number;
  unit: string;
  slug: string;
  rating: number;
  staff_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  feedback: string;
  created_at: Date | string;
};

function loadDatabaseUrl(file: string): string {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return value.replace(/\\n/g, '').trim();
  }
  throw new Error('DATABASE_URL missing from local environment file');
}

function foodSignal(feedback: string): string {
  const matched = analyzeFeedbackText(feedback).signals.filter((signal) => signal === 'negative:food_quality' || signal === 'negative:temperature');
  if (matched.length === 0) return 'sin_señal_detectada';
  return matched.map((signal) => signal === 'negative:food_quality' ? 'calidad' : 'temperatura').join('/');
}

function validateRows(rows: CsvRow[]): void {
  for (const row of rows) {
    if (Object.keys(row).length !== CSV_HEADERS.length || CSV_HEADERS.some((header) => !(header in row))) {
      throw new Error('CSV row does not have the approved columns');
    }
    if (!Object.values(UNIT_NAMES).includes(row.unidad)) throw new Error(`Unexpected unit in scoped query: ${row.unidad}`);
    if (!row.comentario.trim()) throw new Error('Blank feedback passed export filter');
  }
}

async function run(window: WeekWindow): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true, mode: 0o700 });
  const pool = new Pool({ connectionString: loadDatabaseUrl(ENV_PATH), max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL statement_timeout = 10000');
    const result = await client.query<DbRow>({
      text: 'SELECT r.restaurant_id, x.name AS unit, x.slug, r.rating, r.staff_name, r.customer_name, r.customer_email, r.feedback, r.created_at FROM reviews r JOIN restaurants x ON x.id = r.restaurant_id WHERE r.restaurant_id = ANY($1::int[]) AND r.created_at >= $2::timestamptz AND r.created_at < $3::timestamptz AND r.feedback IS NOT NULL AND btrim(r.feedback) <> $4 ORDER BY x.name, r.created_at, r.id',
      values: [UNIT_IDS, window.startUtc, window.endUtc, ''],
    });
    const unitCounts = Object.fromEntries(Object.keys(UNIT_NAMES).map((slug) => [slug, 0] as const));
    const redactionCounts: Record<string, number> = {};
    const signalCounts: Record<string, number> = { calidad: 0, temperatura: 0, sin_señal_detectada: 0 };
    const outputRows: CsvRow[] = [];
    let uncertainRows = 0;
    let formulaNeutralizations = 0;
    for (const row of result.rows) {
      const unit = UNIT_NAMES[row.slug];
      if (!unit) throw new Error(`Unexpected unit slug in scoped query: ${row.slug}`);
      const redacted = redactComment(row.feedback, row.customer_name, row.customer_email);
      for (const [kind, count] of Object.entries(redacted.counts)) redactionCounts[kind] = (redactionCounts[kind] ?? 0) + count;
      if (redacted.uncertain) uncertainRows += 1;
      const signal = foodSignal(redacted.text);
      if (signal === 'sin_señal_detectada') signalCounts.sin_señal_detectada += 1;
      else for (const tag of new Set(signal.split('/'))) signalCounts[tag] += 1;
      const date = localIso(new Date(row.created_at));
      const waiter = row.staff_name?.trim() ?? '';
      const fields = [unit, date, waiter, redacted.text];
      formulaNeutralizations += fields.filter((field) => /^[=+\-@]/.test(field)).length;
      outputRows.push({ unidad: unit, fecha: date, calificacion: String(row.rating), mesero: waiter, comentario: redacted.text, senal_comida: signal });
      unitCounts[row.slug] += 1;
    }
    outputRows.sort((a, b) => a.unidad.localeCompare(b.unidad, 'es') || a.fecha.localeCompare(b.fecha));
    validateRows(outputRows);
    const csv = `﻿${toCsv(outputRows)}`;
    if (!csv.startsWith('﻿') || !csv.includes('\r\n')) throw new Error('CSV safety validation failed');
    const stem = `guest-comments-${window.startDate}_to_${window.endDateExclusive}`;
    fs.writeFileSync(path.join(OUTPUT_DIR, `${stem}.csv`), csv, { mode: 0o600 });
    const manifest = {
      period: { start: window.startDate, endExclusive: window.endDateExclusive, timezone: TZ },
      counts: { rows: outputRows.length, units: unitCounts, redactions: redactionCounts, foodSignals: signalCounts, uncertainRows, formulaNeutralizations },
      csvSafety: { utf8Bom: true, crlf: true, quotedFields: true, formulaInjectionGuard: true },
      query: { readOnly: true, statementTimeoutMs: 10000 },
      manualReviewRequired: true,
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, `${stem}.json`), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(manifest.counts)}\n`);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
