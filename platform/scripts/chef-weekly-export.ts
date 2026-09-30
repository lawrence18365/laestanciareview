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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const ENV_PATH = path.resolve(SCRIPT_DIR, '../.env.local');
const OUTPUT_DIR = path.join(REPO_ROOT, 'data/chef-exports');
const TZ = 'America/Mexico_City';
const REDACTION_MARKER = '[datos personales omitidos]';
const UNIT_IDS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const UNIT_NAMES: Record<string, string> = {
  'estancia-angelopolis': 'La Estancia Argentina Angelópolis',
  'estancia-queretaro': 'La Estancia Argentina Querétaro',
  'estancia-veracruz': 'La Estancia Argentina Veracruz',
  'steakcompany-queretaro': 'Steak Company Querétaro',
  'harbors-angelopolis': "Harbor's Angelópolis",
  'la-silla-huexotitla': 'La Silla Huexotitla',
  'harbors-veracruz': "Harbor's Veracruz",
  'la-silla-juarez': 'La Silla Juárez',
  'estancia-xalapa': 'La Estancia Argentina Xalapa',
  'estancia-leon': 'La Estancia Argentina León',
  'estancia-juarez': 'La Estancia Argentina Juárez',
  'regio-norte': 'Regio Norte',
};
const CSV_HEADERS = ['unidad', 'fecha', 'calificacion', 'mesero', 'comentario', 'senal_comida'] as const;

type CsvRow = Record<(typeof CSV_HEADERS)[number], string>;
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

export type WeekWindow = {
  startDate: string;
  endDateExclusive: string;
  startUtc: string;
  endUtc: string;
};

function dateParts(value: Date, timeZone = TZ): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function calendarDateInMexicoCity(value: Date): string {
  const fields = dateParts(value);
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function parseCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('--week-start must use YYYY-MM-DD');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('--week-start must be a real calendar date');
  }
  return date;
}

function addCalendarDays(date: string, days: number): string {
  const parsed = parseCalendarDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function localMidnightUtc(date: string): string {
  const desired = parseCalendarDate(date).valueOf();
  const candidate = new Date(desired);
  const local = dateParts(candidate);
  const localTimestamp = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute), Number(local.second));
  const offset = localTimestamp - candidate.valueOf();
  return new Date(desired - offset).toISOString();
}

export function computeWeekWindow(weekStart: string | undefined, now = new Date()): WeekWindow {
  const today = calendarDateInMexicoCity(now);
  let startDate: string;
  if (weekStart === undefined) {
    const todayDate = parseCalendarDate(today);
    const daysSinceMonday = (todayDate.getUTCDay() + 6) % 7;
    startDate = addCalendarDays(today, -(daysSinceMonday + 7));
  } else {
    const start = parseCalendarDate(weekStart);
    if (start.getUTCDay() !== 1) throw new Error('--week-start must be a Monday in America/Mexico_City');
    if (weekStart > today) throw new Error('--week-start cannot be in the future');
    startDate = weekStart;
  }
  const endDateExclusive = addCalendarDays(startDate, 7);
  return {
    startDate,
    endDateExclusive,
    startUtc: localMidnightUtc(startDate),
    endUtc: localMidnightUtc(endDateExclusive),
  };
}

export function parseArgs(args: string[], now = new Date()): WeekWindow {
  if (args.length === 0) return computeWeekWindow(undefined, now);
  if (args.length !== 2 || args[0] !== '--week-start') {
    throw new Error('Usage: chef-weekly-export.ts [--week-start YYYY-MM-DD]');
  }
  return computeWeekWindow(args[1], now);
}

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceKnown(text: string, value: string, counts: Record<string, number>, kind: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return text;
  return text.replace(new RegExp(escapeRegExp(trimmed), 'giu'), () => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    return REDACTION_MARKER;
  });
}

function replacePattern(text: string, pattern: RegExp, counts: Record<string, number>, kind: string): string {
  return text.replace(pattern, () => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    return REDACTION_MARKER;
  });
}

export function redactComment(raw: string, customerName: string | null, customerEmail: string | null): { text: string; counts: Record<string, number>; uncertain: boolean } {
  const counts: Record<string, number> = {};
  let text = raw;
  text = replaceKnown(text, customerEmail ?? '', counts, 'email');
  text = replaceKnown(text, customerName ?? '', counts, 'guest_name');
  text = replacePattern(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, counts, 'email');
  text = replacePattern(text, /(?:https?:\/\/|www\.)[^\s<]+|(?:wa\.me|t\.me|instagram\.com|facebook\.com|bit\.ly)\/[^\s<]+/giu, counts, 'contact_url');
  text = replacePattern(text, /[@＠][a-z0-9_.-]{2,}/giu, counts, 'contact_handle');
  text = replacePattern(text, /[+]?(?:\d[\s().-]?){8,15}\d/g, counts, 'phone');
  const properName = /(?<![.!?]\s)(?:\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+){1,2}\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/u.test(raw);
  const residualContact = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:https?:\/\/|www\.)|[@＠][a-z0-9_.-]{2,}/iu.test(text);
  return { text, counts, uncertain: properName || residualContact || Object.keys(counts).length > 0 };
}

function formatOffset(value: Date): string {
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(value).find((part) => part.type === 'timeZoneName')?.value;
  const match = zone?.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) throw new Error(`Could not determine ${TZ} offset`);
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`;
}

function localIso(value: Date): string {
  const fields = dateParts(value);
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}${formatOffset(value)}`;
}

export function csvField(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(rows: CsvRow[]): string {
  return [CSV_HEADERS, ...rows.map((row) => CSV_HEADERS.map((header) => csvField(row[header])))]
    .map((line) => line.join(','))
    .join('\r\n') + '\r\n';
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
