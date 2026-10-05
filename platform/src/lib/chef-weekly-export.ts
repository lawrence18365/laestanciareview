// Runtime-safe primitives shared by the manual exporter and weekly email.
export const TZ = 'America/Mexico_City';
const REDACTION_MARKER = '[datos personales omitidos]';
export const UNIT_IDS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const UNIT_NAMES: Record<string, string> = {
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
  if (endDateExclusive > today) throw new Error('--week-start must identify a complete week');
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

export function redactComment(raw: string, customerName: string | null, customerEmail: string | null, knownNames: string[] = [], allowSafelyRedactedRows = false): { text: string; counts: Record<string, number>; uncertain: boolean } {
  const counts: Record<string, number> = {};
  let text = raw;
  text = replaceKnown(text, customerEmail ?? '', counts, 'email');
  const genericNames = /^(?:cliente|an[oó]nimo|sin nombre|excelente|muy bien|no aplica|cortes|carne|sopa|crema|comida|alimentos|servicio|mesa|bueno|buena|bien|admin)$/iu;
  // Meaningful known first names can appear without surnames. Scrub them, but
  // never expand all surname fragments (e.g. Sal/Cortes) into generic matches.
  const fullNames = [...new Set([customerName ?? '', ...knownNames].map((name) => name.trim()))].sort((a, b) => b.length - a.length);
  // Complete matches must finish before ANY first-name expansion.
  const names = [...fullNames, ...fullNames.map((name) => name.split(/\s+/)[0]).filter((name) => name.length >= 4)];
  for (const name of new Set(names)) {
    if (name.trim().length < 3 || genericNames.test(name.trim())) continue;
    const pattern = [...name.normalize('NFD').replace(/\p{M}/gu, '')].map((char) => {
      const variants: Record<string, string> = { a: '[aáàä]', e: '[eéèë]', i: '[iíìï]', o: '[oóòö]', u: '[uúùü]', n: '[nñ]' };
      return variants[char.toLowerCase()] ?? escapeRegExp(char);
    }).join('');
    text = replacePattern(text, new RegExp(`(?<![\\p{L}])${pattern}(?![\\p{L}])`, 'giu'), counts, 'known_name');
  }
  // Only explicit service-person grammar permits an unknown identity to be
  // scrubbed. Culinary words and grammatical continuations are not identities.
  if (allowSafelyRedactedRows) text = text.replace(/\b(meser[oa]|servicio de|atenci[oó]n de)\s+(?:\[datos personales omitidos\]\s+)?(\p{L}+(?:\s+\p{L}+){0,2}?)\s*(?=\s+(?:fue|estuvo|es|era|muy|nos|me|bien|excelente|atento|amable)\b|[,;.!?\n]|$)/giu,
    (match, role: string, identity: string) => {
      if (/\b(?:la|el|su|nuestro|ya|que|fue|estuvo|es|era|muy|nos|me|bien|excelente|atento|amable|comida|sopa|corte|carne|platillo|pasta|sal|filete|postre|cocina)\b/iu.test(identity)) return match;
      counts.context_name = (counts.context_name ?? 0) + 1;
      return `${role} ${REDACTION_MARKER} `;
    });
  text = replacePattern(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, counts, 'email');
  text = replacePattern(text, /(?:https?:\/\/|www\.)[^\s<]+|(?:wa\.me|t\.me|instagram\.com|facebook\.com|bit\.ly)\/[^\s<]+/giu, counts, 'contact_url');
  text = replacePattern(text, /[@＠][a-z0-9_.-]{2,}/giu, counts, 'contact_handle');
  text = replacePattern(text, /[+]?(?:\d[\s().-]?){8,15}\d/g, counts, 'phone');
  const identityText = allowSafelyRedactedRows ? text : raw;
  const properName = /(?<![.!?]\s)(?:\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s+){1,2}\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b/u.test(identityText);
  const residualAttribution = /(?:[Mm]eser[oa]|[Aa]tendi[oó]|[Gg]racias(?: a)?|por parte de|servicio de)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}|\([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\)/u.test(text);
  // An attribution not resolved by a complete known identity is not safe just
  // because it is lowercase, a nickname, or a surname after a redaction marker.
  const unresolvedContext = /(?:meser[oa]|hostess?|hostes|capit[aá]n|gracias(?: a)?|por parte de|servicio de|atendi[oó](?: por)?)\s+(?!a\b|por\b|ya\s+que\b|fue\s+(?:atento|amable)\b|\[datos personales omitidos\])\p{L}/iu.test(text) ||
    /(?:^|[,;.!?])[^,;.!?\n]*\p{L}[^,;.!?\n]*\b(?:nos|me)\s+atendi[oó]/iu.test(text.replaceAll(REDACTION_MARKER, '')) && !/\[datos personales omitidos\]\s+(?:nos|me)\s+atendi[oó]/iu.test(text);
  const residualTail = /\[datos personales omitidos\]\s+(?:(?:de|del|la|los)\s+)*[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/u.test(text) ||
    /\[datos personales omitidos\]\s+(?!(?:nos|me|muy|es|fue|y|la|el|con|por|para|sin|en|que|estuvo|bien|excelente|atento|amable|atendi[oó])\b)(?:de[l]?\s+)?\p{L}{2,}/iu.test(text);
  const unresolvedSingleName = /(?:servicio|atenci[oó]n)\s+(?:de\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/u.test(text);
  const parentheticalIdentity = /\(\s*\p{L}{2,}(?:\s+\p{L}+){0,3}\s*\)/u.test(text);
  const residualContact = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:https?:\/\/|www\.)|[@＠][a-z0-9_.-]{2,}/iu.test(text);
  return { text, counts, uncertain: properName || residualAttribution || unresolvedContext || residualTail || unresolvedSingleName || parentheticalIdentity || residualContact || (!allowSafelyRedactedRows && Object.keys(counts).length > 0) };
}

function formatOffset(value: Date): string {
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(value).find((part) => part.type === 'timeZoneName')?.value;
  const match = zone?.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) throw new Error(`Could not determine ${TZ} offset`);
  return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`;
}

export function localIso(value: Date): string {
  const fields = dateParts(value);
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}${formatOffset(value)}`;
}

export function csvField(value: string): string {
  const safe = /^[\s﻿]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(rows: CsvRow[]): string {
  return [CSV_HEADERS, ...rows.map((row) => CSV_HEADERS.map((header) => csvField(row[header])))]
    .map((line) => line.join(','))
    .join('\r\n') + '\r\n';
}

