import { createHash } from 'node:crypto';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { sendEmail, escapeHtml, emailLayout } from './email';
import { computeWeekWindow, csvField, localIso, UNIT_IDS, UNIT_NAMES, type WeekWindow } from './chef-weekly-export';

const EVENT_NAME = 'chef_report_delivery';
const MAX_TARGETS = 2;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 20 * 60 * 60 * 1000;
const SMTP_TIMEOUT_MS = 8000;
const SWEEP_TIMEOUT_MS = 45000;
const DEFAULT_REPLY_TO = 'hello@ratetapmx.com';
const BODY_LIMIT = 8;
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}
export interface ChefPool { connect(): Promise<SqlClient> }
export type ChefEnv = Partial<Pick<NodeJS.ProcessEnv, 'CHEF_REPORT_ENABLED' | 'CHEF_REPORT_EMAIL' | 'CHEF_REPORT_EMAILS' | 'CHEF_REPORT_REPLY_TO' | 'CHEF_REPORT_PREVIEW_EMAILS' | 'DATABASE_URL'>>;
/** Private classifier input. Never returned, logged, or attached. */
export type CapturedComment = {
  restaurant_id: number; slug: string; rating: number; feedback: string;
  created_at: Date | string;
};
export type Unit = { id: number; slug: string };

// The only descriptive vocabulary authorized for automatic output. No captures,
// feedback fragments, inferred causes, or identity detection authorize a label.
export const KITCHEN_SIGNALS = Object.freeze({
  costillero_texture: { kind: 'concern', label: 'Costillero: textura para revisar' },
  asado_doneness: { kind: 'concern', label: 'Asado de tira: término para revisar' },
  cut_flavor: { kind: 'concern', label: 'Corte: sabor para revisar' },
  cut_doneness: { kind: 'concern', label: 'Corte: término para revisar' },
  soup_salt: { kind: 'concern', label: 'Sopa: sal para revisar' },
  soup_temperature: { kind: 'concern', label: 'Sopa: temperatura para revisar' },
  filete_overcooked: { kind: 'concern', label: 'Filete: reporte de cocción excesiva' },
  plate_presentation_suggestion: { kind: 'suggestion', label: 'Platillos: sugerencia sobre presentación sencilla' },
  cut_temperature: { kind: 'concern', label: 'Corte: temperatura para revisar' },
  spinach_cream_flavor: { kind: 'concern', label: 'Crema de espinaca: sabor para revisar' },
  pomodoro_preparation: { kind: 'concern', label: 'Pasta Pomodoro: preparación para revisar' },
  cream_flavor: { kind: 'concern', label: 'Cremas: sabor para revisar' },
  burger_hard_fragments: { kind: 'concern', label: 'Hamburguesa: fragmentos duros reportados; causa no verificada' },
  food_quality_concern: { kind: 'concern', label: 'Alimentos: calidad para revisar' },
  food_temperature_concern: { kind: 'concern', label: 'Alimentos: temperatura para revisar' },
  menu_suggestion: { kind: 'suggestion', label: 'Menú: sugerencia de opciones' },
  food_praise: { kind: 'positive', label: 'Alimentos: valoración positiva detectada' },
} as const);
for (const entry of Object.values(KITCHEN_SIGNALS)) Object.freeze(entry);
export type KitchenSignalId = keyof typeof KITCHEN_SIGNALS;
export type PublicKitchenRow = Readonly<{ unit: string; date: string; rating: number; signals: readonly KitchenSignalId[] }>;
const NO_SIGNAL = 'Sin señal culinaria automática';
export type ChefReport = {
  subject: string; text: string; html: string; replyTo: string;
  rows: readonly PublicKitchenRow[];
  attachments: { filename: string; content: string; contentType: string }[];
  counts: { captured: number; kitchen: number; unclassified: number };
};

export function validateScope(units: Unit[]): void {
  if (units.length !== UNIT_IDS.length || new Set(units.map((u) => u.id)).size !== UNIT_IDS.length ||
      new Set(units.map((u) => u.slug)).size !== UNIT_IDS.length ||
      units.some((u) => !UNIT_IDS.includes(u.id) || !Object.hasOwn(UNIT_NAMES, u.slug))) {
    throw new Error('chef_scope_mismatch');
  }
}

export function signalLabel(id: KitchenSignalId): string {
  if (typeof id !== 'string' || !Object.hasOwn(KITCHEN_SIGNALS, id)) throw new Error('chef_signal_invalid');
  return KITCHEN_SIGNALS[id].label;
}

/** Explicit reconstruction is the public trust boundary, including at runtime. */
export function publicKitchenRow(unit: unknown, date: unknown, rating: unknown, signals: readonly KitchenSignalId[]): PublicKitchenRow {
  if (typeof unit !== 'string' || !Object.values(UNIT_NAMES).includes(unit) ||
      typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
      typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5 || !Array.isArray(signals)) {
    throw new Error('chef_public_row_invalid');
  }
  const validated = signals.map((id) => { signalLabel(id); return id; });
  return Object.freeze({ unit, date, rating, signals: Object.freeze([...new Set(validated)]) });
}

// Topic relevance only: never writes classifications or alert severity.
export function isKitchenTopic(text: string): boolean {
  const normalized = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return /\b(?:comida|alimentos?|platillos?|platos?|cocina|pastas?|pomodoro|cremas?|cortes?|carnes?|costilleros?|costillas?|asados?|hamburguesas?|sopas?|sal|salad[oa]s?|azucar|postres?|pasteles?|terminos?|coccion|sabor(?:es)?|sazon|sazonad[oa]s?|condiment[oa]s?|salsas?|filetes?|steaks?|espinacas?|pescados?|mariscos?|pollos?|ensaladas?)\b/u.test(normalized);
}

// Chef-owned lexical matches only. Negation is bounded to the three words
// before a descriptor; neither global review polarity nor star ratings decide.
function unnegatedDescriptor(text: string, pattern: RegExp): boolean {
  return [...text.matchAll(pattern)].some((match) =>
    !/\b(?:no|sin|nunca|nada)(?:\s+\w+){0,3}\s*$/u.test(text.slice(0, match.index)));
}

function culinaryPraise(text: string): boolean {
  return text.split(/,|\b(?:mesero|servicio|atencion)\b/u).some((part) => isKitchenTopic(part) &&
    unnegatedDescriptor(part, /\b(?:ric[oa]s?|delicios[oa]s?|sabros[oa]s?|buen[oa]s?|excelente|exquisit[oa]s?)\b/gu));
}

/** Bounded chef-only rules; private strings terminate here as finite enum IDs. */
export function classifyKitchenSignals(feedback: string): KitchenSignalId[] {
  const found = new Set<KitchenSignalId>();
  let precedingCutConcern = false;
  let contextBudget = 0;
  // Clauses supply bounded food context, not public prose. A short taste/term
  // continuation can refer to the immediately preceding cut concern; a service
  // clause, new dish, praise, or negation cannot inherit that concern.
  for (const clause of feedback.split(/[.!?;\n]+|\bpero\b/iu)) {
    const t = clause.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
    if (!t) continue;
    const positive = culinaryPraise(t);
    const ids = new Set<KitchenSignalId>();
    if (precedingCutConcern && contextBudget-- > 0 && t.length <= 100 &&
        /\b(?:sabor|termino)\b/u.test(t) &&
        !/\b(?:no|sin|mesero|servicio|atencion|sopa|crema|pasta|filete|hamburguesa|postre)\b/u.test(t) && !positive) {
      if (/\bsabor\b/u.test(t)) ids.add('cut_flavor');
      if (/\btermino\b/u.test(t)) ids.add('cut_doneness');
    }
    if (!isKitchenTopic(clause)) {
      if (/\b(?:mesero|servicio|atencion|gracias)\b/u.test(t) || contextBudget <= 0 || t.length > 100) precedingCutConcern = false;
      continue;
    }
    const request = /\b(?:mejor(?:ar|en)|cuid(?:ar|en)|vigilar|cambi(?:ar|en)|falta(?:n)?|sencill[oa]s?)\b|dejo mucho que desear|mas rojo|(?:demasiado|muy) rojo|se pas(?:o|aron) de cocido|(?:demasiado|muy) cocid[oa]/iu.test(t) &&
      !/\b(?:no|sin|nunca)(?:\s+\w+){0,3}\s+(?:(?:demasiado|muy|mas) (?:cocid[oa]|rojo)|falt[oa])/u.test(t) &&
      !/\b(?:no|nada|sin)\s+(?:(?:hay|que|hace|les?|le)\s+){0,2}(?:mejorar|cuidar|falta|cambiar)|nada que (?:agregar|cambiar)/u.test(t);
    const menu = /variedad|(?:agregar|opciones).{0,30}(?:postr|platill|pastel|men[uú]|comida)|vender al publico|postres? (?:anteriores|bajo|sin)|pastel de cumpleanos|ingredientes endulzados|azucar/u.test(t) &&
      !/\bno\s+(?:(?:podria|hay|quiero|necesito)\s+)?(?:agregar|opciones)|nada que agregar/u.test(t);
    const missingFlavor = /\b(?:no|sin|nada|ni|tampoco|falto|falta|faltaba)(?:\s+\w+){0,4}\s+(?:sabor|sazon|ric[oa]|buen[oa]|sabros[oa])\b/u.test(t) &&
      !/\bno(?:\s+\w+){0,2}\s+falt[oa](?:\s+\w+){0,4}\s+(?:sabor|sazon)\b/u.test(t);
    const negative = request || missingFlavor || unnegatedDescriptor(t,
      /\b(?:mal[oa]s?|pesim[oa]s?|horribles?|incomible|desabrid[oa]|deshabrid[oa]|insipid[oa]|sec[oa]|resec[oa]s?|dur[oa]s?|chiclos[oa]|quemad[oa]|crud[oa]|grasos[oa]|salad[oa]|sos[oa]|aguad[oa]|ranci[oa]|agri[oa])\b/gu);
    const cold = unnegatedDescriptor(t, /\b(?:fri[oa]s?|tibi[oa]s?|helad[oa]s?)\b/gu);
    if (negative) {
      if (/\bcostilleros?\b/u.test(t) && /dur[oa]|textura|chiclos/u.test(t)) ids.add('costillero_texture');
      if (/\basado\b/u.test(t) && /termino|rojo|coccion|cocid/u.test(t)) ids.add('asado_doneness');
      if (/\b(?:cortes?|carnes?)\b/u.test(t)) {
        if (/sabor|sazon/u.test(t)) ids.add('cut_flavor');
        if (/termino|coccion|cocid|crud[oa]/u.test(t)) ids.add('cut_doneness');
      }
      if (/\bsopas?\b/u.test(t) && /\bsal\b|salad[oa]/u.test(t)) ids.add('soup_salt');
      if (/\bfiletes?\b/u.test(t) && /demasiado cocid|muy cocid|pas(?:o|aron|ado).{0,15}cocid|sobreco/u.test(t)) ids.add('filete_overcooked');
      if (/\b(?:platillos?|platos?)\b/u.test(t) && /sencill[oa]|presentacion/u.test(t)) ids.add('plate_presentation_suggestion');
      if (/\bcremas?\b/u.test(t) && /\bespinacas?\b/u.test(t)) ids.add('spinach_cream_flavor');
      else if (/\bcremas?\b/u.test(t)) ids.add('cream_flavor');
      if (/\bpomodoro\b/u.test(t)) ids.add('pomodoro_preparation');
      if (/\bhamburguesas?\b/u.test(t) && /\b(?:fragmentos?|pedazos?|pedacitos?|trozos?).{0,40}dur[oa]/u.test(t)) ids.add('burger_hard_fragments');
    }
    if (cold) {
      if (/\bsopas?\b/u.test(t)) ids.add('soup_temperature');
      else if (/\b(?:cortes?|carnes?)\b/u.test(t)) ids.add('cut_temperature');
      else ids.add('food_temperature_concern');
    }
    if (menu && !negative && !cold) ids.add('menu_suggestion');
    else if (negative && !ids.size && !cold) ids.add('food_quality_concern');
    if (positive && !negative && !cold && !menu) ids.add('food_praise');
    for (const id of ids) found.add(id);
    precedingCutConcern = negative && /\bcortes?\b/u.test(t);
    contextBudget = precedingCutConcern ? 2 : 0;
  }
  // A specific concern wins even when generic praise is in another clause.
  if ([...found].some((id) => KITCHEN_SIGNALS[id].kind === 'concern')) found.delete('food_praise');
  return [...found];
}

function labels(row: PublicKitchenRow): string {
  return row.signals.length ? row.signals.map(signalLabel).join('; ') : NO_SIGNAL;
}
function csv(rows: readonly PublicKitchenRow[]): string {
  const header = ['unidad', 'fecha', 'calificacion', 'observaciones_automaticas'];
  return '﻿' + [header, ...rows.map((r) => [r.unit, r.date, String(r.rating), labels(r)])]
    .map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

export function buildChefReport(window: WeekWindow, units: Unit[], rows: CapturedComment[], replyAddress = DEFAULT_REPLY_TO): ChefReport {
  const replyTo = normalizeRecipient(replyAddress);
  validateScope(units);
  const canonicalWindow = computeWeekWindow(window.startDate, new Date(window.endUtc));
  if (Object.keys(canonicalWindow).some((key) => canonicalWindow[key as keyof WeekWindow] !== window[key as keyof WeekWindow])) throw new Error('chef_window_invalid');
  const unitsById = new Map(units.map((u) => [u.id, u.slug]));
  const coverage = Object.fromEntries(Object.keys(UNIT_NAMES).map((slug) => [slug, 0]));
  const publicRows: PublicKitchenRow[] = [];
  for (const row of rows) {
    if (unitsById.get(row.restaurant_id) !== row.slug) throw new Error('chef_scope_mismatch');
    const date = new Date(row.created_at);
    if (typeof row.feedback !== 'string' || !row.feedback.trim() || !Number.isFinite(date.valueOf()) || date.toISOString() < window.startUtc || date.toISOString() >= window.endUtc) throw new Error('chef_row_mismatch');
    coverage[row.slug] += 1;
    publicRows.push(publicKitchenRow(UNIT_NAMES[row.slug], localIso(date).slice(0, 10), row.rating, classifyKitchenSignals(row.feedback)));
  }
  publicRows.sort((a, b) => a.unit.localeCompare(b.unit, 'es') || a.date.localeCompare(b.date) || a.rating - b.rating);
  const kitchen = publicRows.filter((r) => r.signals.length);
  const has = (r: PublicKitchenRow, kind: 'concern' | 'suggestion' | 'positive') => r.signals.some((id) => KITCHEN_SIGNALS[id].kind === kind);
  const concerns = kitchen.filter((r) => has(r, 'concern')).slice(0, BODY_LIMIT);
  const suggestions = kitchen.filter((r) => !has(r, 'concern') && has(r, 'suggestion')).slice(0, BODY_LIMIT - concerns.length);
  const others = kitchen.filter((r) => !has(r, 'concern') && !has(r, 'suggestion') && has(r, 'positive')).slice(0, BODY_LIMIT - concerns.length - suggestions.length);
  const selected = [...concerns, ...suggestions, ...others];
  const sunday = new Date(`${window.endDateExclusive}T00:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() - 1);
  const period = `lunes ${window.startDate} a domingo ${sunday.toISOString().slice(0, 10)}`;
  const heading = `Observaciones de cocina · ${period}`;
  const total = `${rows.length} comentarios capturados. No son visitas, escaneos ni reseñas publicadas en Google.`;
  const zero = 'Cero comentarios no significa cero actividad.';
  const definitions = `Con señal: ${kitchen.length}. Sin clasificar: ${rows.length - kitchen.length}, sin señal culinaria automática; no equivale a valoración positiva.`;
  const caveat = 'Observaciones automáticas, no causas verificadas ni lectura completa. Las estrellas no descartan problemas.';
  const coverageLines = Object.entries(coverage).map(([slug, count]) => `${UNIT_NAMES[slug]}: ${count}`);
  const observationLines = selected.map((r) => `${r.unit} · ${r.date} · ${r.rating}★\n${labels(r)}`);
  const empty = rows.length === 0 ? 'No se capturaron comentarios durante esta semana.' : 'Sin señales culinarias automáticas esta semana.';
  const tail = `CSV estructurados: ${publicRows.length} registros; ${kitchen.length} con señal. Se muestran ${selected.length}. Comentarios completos solo en seguimiento privado revisado.`;
  const textSections = selected.length ? [
    ...(concerns.length ? ['Para revisar en cocina', ...observationLines.slice(0, concerns.length)] : []),
    ...(suggestions.length ? ['Sugerencias de menú', ...observationLines.slice(concerns.length, concerns.length + suggestions.length)] : []),
    ...(others.length ? ['Valoraciones culinarias positivas', ...observationLines.slice(concerns.length + suggestions.length)] : []),
  ] : [empty];
  const text = [heading, total, definitions, caveat, ...textSections, 'Cobertura por unidad', ...coverageLines, zero, tail, 'Responde con lo revisado en cocina.'].join('\n\n');
  const observationRow = (r: PublicKitchenRow) => `<tr><td style="padding:16px 0;border-bottom:1px solid #E2E2E2;overflow-wrap:anywhere;word-break:break-word;"><p style="margin:0 0 6px;font-size:13px;color:#666666;line-height:1.5;">${escapeHtml(r.unit)} · ${r.date} · ${r.rating}★</p><p class="observation" style="margin:0;padding:0 0 0 14px;border-left:3px solid #111111;font-size:15px;line-height:1.6;color:#111111;">${escapeHtml(labels(r))}</p></td></tr>`;
  const section = (title: string, records: PublicKitchenRow[]) => records.length ? `<tr><td style="padding-top:28px;"><h2 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:700;line-height:1.2;">${title}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">${records.map(observationRow).join('')}</table></td></tr>` : '';
  const summary = [[rows.length, 'Capturados'], [kitchen.length, 'Con señal'], [rows.length - kitchen.length, 'Sin clasificar']].map(([value, label]) => `<td width="33%" style="padding:16px 8px;border-bottom:1px solid #111111;text-align:center;"><p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;font-variant-numeric:tabular-nums;">${value}</p><p style="margin:6px 0 0;font-size:12px;color:#666666;">${label}</p></td>`).join('');
  const coverageRows = Object.entries(coverage).map(([slug, count]) => `<tr><td style="padding:10px 0;border-bottom:1px solid #E2E2E2;font-size:13px;line-height:1.4;">${escapeHtml(UNIT_NAMES[slug])}</td><td width="40" align="right" style="padding:10px 0;border-bottom:1px solid #E2E2E2;font-family:Consolas,Menlo,monospace;font-size:14px;">${count}</td></tr>`).join('');
  const dateLabel = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const visualPeriod = `${dateLabel.format(new Date(`${window.startDate}T00:00:00Z`))} – ${dateLabel.format(sunday)} · lunes a domingo`;
  const subject = `Cocina · ${window.startDate} al ${sunday.toISOString().slice(0, 10)}`;
  const replyHref = `mailto:${replyTo}?subject=${encodeURIComponent(`Re: ${subject}`)}`;
  const html = emailLayout(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;color:#111111;"><tr><td class="content-pad" style="padding:32px;">
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:34px;font-weight:700;line-height:1.1;">Informe de cocina</h1>
    <p style="margin:0 0 24px;color:#666666;font-size:14px;line-height:1.5;">${escapeHtml(visualPeriod)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>${summary}</tr></table>
    <p style="margin:14px 0 0;color:#666666;font-size:12px;line-height:1.5;">${escapeHtml(total)} ${escapeHtml(definitions)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">${section('Para revisar en cocina', concerns)}${section('Sugerencias de menú', suggestions)}${section('Valoraciones culinarias positivas', others)}${!selected.length ? `<tr><td style="padding:24px 0;font-size:15px;line-height:1.6;">${empty}</td></tr>` : ''}</table>
    <p style="margin:16px 0 0;color:#666666;font-size:12px;line-height:1.5;">${escapeHtml(caveat)}</p>
    <h2 style="margin:28px 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:23px;">Cobertura por unidad</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><caption style="text-align:left;font-size:12px;color:#666666;padding-bottom:8px;">Todos los comentarios capturados</caption>${coverageRows}</table>
    <p style="margin:12px 0;color:#666666;font-size:12px;line-height:1.5;">${zero}</p>
    <p style="margin:0;color:#666666;font-size:12px;line-height:1.5;">${escapeHtml(tail)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;"><tr><td style="background:#111111;text-align:center;"><a href="${escapeHtml(replyHref)}" style="display:block;padding:18px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">Responde con lo revisado en cocina.</a></td></tr></table>
  </td></tr></table>`, 'Informe semanal · America/Mexico_City');
  return {
    subject, text, html, replyTo, rows: Object.freeze(publicRows),
    attachments: [
      { filename: `comentarios-${window.startDate}.csv`, content: csv(publicRows), contentType: 'text/csv; charset=utf-8' },
      { filename: `cocina-${window.startDate}.csv`, content: csv(kitchen), contentType: 'text/csv; charset=utf-8' },
    ],
    counts: { captured: rows.length, kitchen: kitchen.length, unclassified: rows.length - kitchen.length },
  };
}

export async function loadChefReport(pool: ChefPool, window: WeekWindow, replyTo = DEFAULT_REPLY_TO): Promise<ChefReport> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL statement_timeout = 2000');
    const units = (await client.query('SELECT id, slug FROM restaurants WHERE id = ANY($1::int[]) ORDER BY id', [UNIT_IDS])).rows as Unit[];
    validateScope(units);
    const values = [UNIT_IDS, window.startUtc, window.endUtc];
    const filter = "restaurant_id = ANY($1::int[]) AND created_at >= $2::timestamptz AND created_at < $3::timestamptz AND feedback IS NOT NULL AND btrim(feedback) <> ''";
    const count = (await client.query(`SELECT count(*)::int AS captured FROM reviews WHERE ${filter}`, values)).rows[0];
    const rows = (await client.query(`SELECT restaurant_id, x.slug, rating, feedback, r.created_at FROM reviews r JOIN restaurants x ON x.id = r.restaurant_id WHERE ${filter.replace(/\b(restaurant_id|created_at|feedback)\b/g, 'r.$1')} ORDER BY r.created_at, r.id`, values)).rows as CapturedComment[];
    if (Number(count?.captured) !== rows.length) throw new Error('chef_count_mismatch');
    return buildChefReport(window, units, rows, replyTo);
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

export function normalizeRecipient(value: string | undefined): string {
  if (/[\r\n]/.test(value ?? '')) throw new Error('chef_recipient_missing_or_invalid');
  const address = (value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(address) || address.length > 254 || address.split('@')[0].length > 64) {
    throw new Error('chef_recipient_missing_or_invalid');
  }
  return address;
}

export function liveRecipients(env: ChefEnv, required = true): string[] {
  const legacy = env.CHEF_REPORT_EMAIL;
  const list = env.CHEF_REPORT_EMAILS;
  const recipients = list === undefined ? (legacy === undefined ? [] : [normalizeRecipient(legacy)]) :
    [...new Set(list.split(',').map(normalizeRecipient))];
  if (legacy !== undefined && list !== undefined && (recipients.length !== 1 || normalizeRecipient(legacy) !== recipients[0])) throw new Error('chef_conflicting_legacy_recipient');
  if (required && !recipients.length) throw new Error('chef_recipient_missing_or_invalid');
  if (recipients.length > MAX_TARGETS) throw new Error('chef_live_target_count_invalid');
  return recipients;
}

export function previewRecipients(values: string[], env: ChefEnv): string[] {
  if (!values.length || !env.CHEF_REPORT_PREVIEW_EMAILS?.trim()) throw new Error('chef_preview_allowlist_required');
  const allowed = env.CHEF_REPORT_PREVIEW_EMAILS.split(',').map(normalizeRecipient);
  const live = liveRecipients(env, false);
  const recipients = [...new Set(values.map(normalizeRecipient))];
  if (recipients.length > MAX_TARGETS || recipients.some((to) => !allowed.includes(to) || live.includes(to))) throw new Error('chef_preview_recipient_not_allowed');
  return recipients;
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export function deliveryKey(namespace: 'preview' | 'live', week: string, to: string) {
  const recipientHash = hash(normalizeRecipient(to));
  return { namespace, weekStart: week, recipientHash, fingerprint: hash(`${namespace}:${week}:${recipientHash}`) };
}
export type DeliveryStatus = 'attempted' | 'sent' | 'failed' | 'unknown';
export type DeliveryOutcome = { status: DeliveryStatus | 'skipped'; recipientHash: string; weekStart?: string; previousStatus?: DeliveryStatus; code?: string };
type Reservation = { id?: string; previousStatus?: DeliveryStatus; code?: string };

async function lock(client: SqlClient, fingerprint: string) {
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [BigInt(`0x${fingerprint.slice(0, 15)}`).toString()]);
}
async function existingDelivery(client: SqlClient, fingerprint: string) {
  return (await client.query("SELECT id, properties FROM product_events WHERE event_name = $1 AND properties->>'fingerprint' = $2", [EVENT_NAME, fingerprint])).rows;
}

export async function reserveDelivery(pool: ChefPool, key: ReturnType<typeof deliveryKey>, options: { now?: Date; retry?: boolean; existingOnly?: boolean } = {}): Promise<Reservation> {
  const now = options.now ?? new Date();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 2000');
    // Same connection owns the transaction, lock, read and committed reservation.
    await lock(client, key.fingerprint);
    const rows = await existingDelivery(client, key.fingerprint);
    if (rows.length > 1) throw new Error('chef_duplicate_ledger_manual_check');
    const existing = rows[0];
    if (existing) {
      const p = existing.properties as Record<string, unknown>;
      const previousStatus: DeliveryStatus = ['attempted', 'sent', 'failed', 'unknown'].includes(String(p.status)) ? p.status as DeliveryStatus : 'unknown';
      const attempts = Number(p.attempts);
      const nextAttempt = Date.parse(String(p.retryAfter));
      if (options.retry && key.namespace === 'live' && previousStatus === 'failed' && p.retryable === true &&
          Number.isInteger(attempts) && attempts >= 1 && attempts < MAX_ATTEMPTS && Number.isFinite(nextAttempt) && now.valueOf() >= nextAttempt) {
        await client.query('UPDATE product_events SET properties = properties || $1::jsonb WHERE id = $2 AND event_name = $3',
          [JSON.stringify({ status: 'attempted', attempts: attempts + 1, retryable: false, attemptedAt: now.toISOString(), source: 'automated_smtp' }), String(existing.id), EVENT_NAME]);
        await client.query('COMMIT');
        return { id: String(existing.id) };
      }
      await client.query('COMMIT');
      return { previousStatus, code: previousStatus === 'failed' ? 'definite_failure_retry_bounded_or_exhausted' : previousStatus === 'sent' ? undefined : 'manual_check_no_retry' };
    }
    if (options.existingOnly) { await client.query('COMMIT'); return { code: 'no_failed_backlog' }; }
    const inserted = (await client.query('INSERT INTO product_events (event_name, restaurant_id, staff_id, properties) VALUES ($1, NULL, NULL, $2::jsonb) RETURNING id',
      [EVENT_NAME, JSON.stringify({ ...key, status: 'attempted', attempts: 1, retryable: false, attemptedAt: now.toISOString(), source: 'automated_smtp' })])).rows[0];
    if (!inserted?.id) throw new Error('chef_reservation_missing');
    await client.query('COMMIT');
    return { id: String(inserted.id) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function finishDelivery(pool: ChefPool, id: string, status: DeliveryStatus, now: Date, retryable: boolean, messageId?: string) {
  const client = await pool.connect();
  try {
    const result = await client.query("UPDATE product_events SET properties = properties || $1::jsonb WHERE id = $2 AND event_name = $3 AND properties->>'status' = 'attempted' RETURNING id",
      [JSON.stringify({ status, retryable, finishedAt: now.toISOString(), ...(retryable ? { retryAfter: new Date(now.valueOf() + RETRY_DELAY_MS).toISOString() } : {}), ...(messageId ? { messageId } : {}) }), id, EVENT_NAME]);
    if (result.rows.length !== 1) throw new Error('chef_ledger_finalize_not_confirmed');
  } finally { client.release(); }
}

function definiteNoAcceptance(error: unknown): boolean {
  const e = error as { code?: string; responseCode?: number; command?: string } | null;
  return e?.code === 'chef_pre_smtp_no_accept' || e?.code === 'chef_recipient_rejected_no_accept' ||
    (e?.command === 'RCPT TO' && Number(e.responseCode) >= 400 && Number(e.responseCode) <= 599);
}

type Send = typeof sendEmail;
export async function deliverChefReport(pool: ChefPool, report: ChefReport, window: WeekWindow, namespace: 'live' | 'preview', to: string, env: ChefEnv, send: Send = sendEmail, options: { now?: Date; retry?: boolean; existingOnly?: boolean } = {}): Promise<DeliveryOutcome> {
  const recipient = normalizeRecipient(to);
  if (namespace === 'preview') previewRecipients([recipient], env);
  else if (env.CHEF_REPORT_ENABLED !== 'true' || !liveRecipients(env).includes(recipient)) throw new Error('chef_live_disabled_or_target_mismatch');
  const key = deliveryKey(namespace, window.startDate, recipient);
  const reservation = await reserveDelivery(pool, key, options);
  if (!reservation.id) return { status: 'skipped', recipientHash: key.recipientHash, weekStart: window.startDate, previousStatus: reservation.previousStatus, code: reservation.code };
  let status: DeliveryStatus;
  let messageId: string | undefined;
  let retryable = false;
  try {
    const result = await send({ to: recipient, replyTo: report.replyTo, subject: `${namespace === 'preview' ? '[VISTA PREVIA] ' : ''}${report.subject}`, text: report.text, html: report.html, attachments: report.attachments, requireRecipientAcceptance: true, smtpTimeoutMs: SMTP_TIMEOUT_MS });
    messageId = result.data?.id;
    status = messageId ? 'sent' : 'unknown';
  } catch (error) {
    retryable = definiteNoAcceptance(error);
    status = retryable ? 'failed' : 'unknown';
  }
  try { await finishDelivery(pool, reservation.id, status, options.now ?? new Date(), retryable, messageId); }
  catch { return { status: 'unknown', recipientHash: key.recipientHash, weekStart: window.startDate, code: 'ledger_finalize_failed_manual_check_no_retry' }; }
  const outcome = { status, recipientHash: key.recipientHash, weekStart: window.startDate, ...(status !== 'sent' ? { code: retryable ? 'definite_no_accept_bounded_daily_retry' : 'smtp_not_confirmed_manual_check_no_retry' } : {}) };
  // Structured metadata only; never pass provider errors or report content.
  console.info('[chef-report]', outcome);
  return outcome;
}

export type ManualSendProof = { namespace: 'live'; source: 'manual_smtp'; status: 'smtp-accepted'; to: string; weekStart: string; messageId: string; acceptedAt: string; evidenceSource?: 'sent_archive_observation'; archiveObservedAt?: string };
export function validateManualAudit(audit: unknown, env: ChefEnv, now = new Date()): ManualSendProof[] {
  const value = audit as { version?: number; deliveries?: unknown[] } | null;
  if (value?.version !== 1 || !Array.isArray(value.deliveries) || !value.deliveries.length || value.deliveries.length > 4) throw new Error('chef_invalid_manual_audit');
  const live = liveRecipients(env);
  const keys = new Set<string>();
  return value.deliveries.map((entry) => {
    const p = entry as ManualSendProof | null;
    if (!p || p.namespace !== 'live' || p.source !== 'manual_smtp' || p.status !== 'smtp-accepted' || typeof p.to !== 'string' ||
        typeof p.weekStart !== 'string' || typeof p.messageId !== 'string' || !p.messageId.trim() || p.messageId !== p.messageId.trim() || p.messageId.length > 998 || /[\r\n]/.test(p.messageId) ||
        typeof p.acceptedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(p.acceptedAt)) throw new Error('chef_invalid_manual_audit');
    const to = normalizeRecipient(p.to);
    const window = computeWeekWindow(p.weekStart, now);
    const acceptedAt = new Date(p.acceptedAt);
    if (!live.includes(to) || !Number.isFinite(acceptedAt.valueOf()) || acceptedAt.toISOString() !== (/\.\d{3}Z$/.test(p.acceptedAt) ? p.acceptedAt : p.acceptedAt.replace('Z', '.000Z')) || acceptedAt.valueOf() < Date.parse(window.endUtc) || acceptedAt.valueOf() > now.valueOf()) throw new Error('chef_invalid_manual_audit');
    const archived = p.evidenceSource !== undefined || p.archiveObservedAt !== undefined;
    if (archived && (p.evidenceSource !== 'sent_archive_observation' || p.archiveObservedAt !== p.acceptedAt)) throw new Error('chef_invalid_manual_audit');
    const key = deliveryKey('live', p.weekStart, to).fingerprint;
    if (keys.has(key)) throw new Error('chef_duplicate_manual_proof');
    keys.add(key);
    return { namespace: 'live', source: 'manual_smtp', status: 'smtp-accepted', to, weekStart: p.weekStart, messageId: p.messageId, acceptedAt: acceptedAt.toISOString(),
      ...(archived ? { evidenceSource: 'sent_archive_observation' as const, archiveObservedAt: acceptedAt.toISOString() } : {}) };
  });
}

export async function importManualDeliveries(pool: ChefPool, audit: unknown, env: ChefEnv, now = new Date()) {
  // Operator-only caller; never SMTP, and validate the complete batch before DB.
  const proofs = validateManualAudit(audit, env, now);
  const records = proofs.map((p) => {
    const key = deliveryKey('live', p.weekStart, p.to);
    const evidence = { ...key, status: 'sent', source: 'manual_smtp_import', retryable: false, messageId: p.messageId, acceptedAt: p.acceptedAt,
      ...(p.evidenceSource ? { evidenceSource: p.evidenceSource, archiveObservedAt: p.archiveObservedAt } : {}) };
    return { key, evidence, proofHash: hash(JSON.stringify(evidence)) };
  }).sort((a, b) => a.key.fingerprint.localeCompare(b.key.fingerprint));
  const client = await pool.connect();
  const outcomes: { recipientHash: string; weekStart: string; status: 'imported' | 'already-imported' }[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = 2000');
    const pending = [];
    for (const record of records) {
      await lock(client, record.key.fingerprint);
      const rows = await existingDelivery(client, record.key.fingerprint);
      const p = rows[0]?.properties as Record<string, unknown> | undefined;
      if (rows.length > 1 || p && (p.status !== 'sent' || p.source !== 'manual_smtp_import' || p.proofHash !== record.proofHash ||
          Object.entries(record.evidence).some(([name, value]) => p[name] !== value))) throw new Error('chef_manual_import_conflict');
      if (!p) pending.push(record);
      outcomes.push({ recipientHash: record.key.recipientHash, weekStart: record.key.weekStart, status: p ? 'already-imported' : 'imported' });
    }
    for (const record of pending) await client.query('INSERT INTO product_events (event_name, restaurant_id, staff_id, properties) VALUES ($1, NULL, NULL, $2::jsonb) RETURNING id',
      [EVENT_NAME, JSON.stringify({ ...record.evidence, proofHash: record.proofHash })]);
    await client.query('COMMIT');
    return outcomes;
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
  finally { client.release(); }
}

export type RunOptions = { mode: 'dry-run' | 'preview' | 'live' | 'import'; weekStart?: string; previewTo?: string[]; audit?: unknown };
export async function runChefReport(options: RunOptions, deps: { env?: ChefEnv; now?: Date; pool?: ChefPool; send?: Send; clock?: () => number } = {}) {
  const env: ChefEnv = deps.env ?? {
    CHEF_REPORT_ENABLED: process.env.CHEF_REPORT_ENABLED,
    CHEF_REPORT_EMAIL: process.env.CHEF_REPORT_EMAIL,
    CHEF_REPORT_EMAILS: process.env.CHEF_REPORT_EMAILS,
    CHEF_REPORT_REPLY_TO: process.env.CHEF_REPORT_REPLY_TO,
    CHEF_REPORT_PREVIEW_EMAILS: process.env.CHEF_REPORT_PREVIEW_EMAILS,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  const now = deps.now ?? new Date();
  if (options.mode === 'live' && env.CHEF_REPORT_ENABLED !== 'true') return { status: 'disabled' as const, outcomes: [] as DeliveryOutcome[] };
  if (options.mode === 'live' && options.weekStart !== undefined) throw new Error('chef_catchup_cli_only');
  const recipients = options.mode === 'live' ? liveRecipients(env) : options.mode === 'preview' ? previewRecipients(options.previewTo ?? [], env) : [];
  const window = computeWeekWindow(options.weekStart, now);
  const replyTo = normalizeRecipient(env.CHEF_REPORT_REPLY_TO ?? DEFAULT_REPLY_TO);
  if (options.mode === 'import') validateManualAudit(options.audit, env, now);
  // First send cannot occur before nominal Monday 14 UTC, even for manual triggers.
  if (options.mode === 'live' && now.valueOf() < Date.parse(window.endUtc) + 8 * 60 * 60 * 1000) return { status: 'not-due' as const, window, outcomes: [] as DeliveryOutcome[] };
  let ownedPool: Pool | undefined;
  if (!deps.pool) {
    if (!env.DATABASE_URL) throw new Error('chef_database_not_configured');
    neonConfig.webSocketConstructor = ws;
    ownedPool = new Pool({ connectionString: env.DATABASE_URL.replace(/\\n/g, '').trim(), max: 1, connectionTimeoutMillis: 2000, query_timeout: 2000 });
  }
  const pool = deps.pool ?? ownedPool!;
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + SWEEP_TIMEOUT_MS;
  try {
    if (options.mode === 'import') return { status: 'imported' as const, outcomes: [] as DeliveryOutcome[], imports: await importManualDeliveries(pool, options.audit, env, now) };
    let report: ChefReport | undefined;
    const outcomes: DeliveryOutcome[] = [];
    const windows = [window];
    if (options.mode === 'live') {
      const previous = new Date(`${window.startDate}T00:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 7);
      windows.push(computeWeekWindow(previous.toISOString().slice(0, 10), now));
    }
    for (const [index, period] of windows.entries()) {
      if (options.mode === 'dry-run') { report = await loadChefReport(pool, period, replyTo); break; }
      for (const to of recipients) {
        const key = deliveryKey(options.mode === 'preview' ? 'preview' : 'live', period.startDate, to);
        if (clock() + SMTP_TIMEOUT_MS + 6000 > deadline) {
          outcomes.push({ status: 'failed', recipientHash: key.recipientHash, weekStart: period.startDate, code: 'sweep_budget_deferred_no_smtp' }); continue;
        }
        try {
          // Don't render an absent backlog or accepted period. Reservation remains
          // the authority: this read is only a SELECT optimization under contention.
          const client = await pool.connect();
          let existing;
          try { existing = await existingDelivery(client, key.fingerprint); } finally { client.release(); }
          if (!existing.length && index > 0) continue;
          if (existing.length === 1) {
            const p = existing[0].properties as Record<string, unknown>;
            const state: DeliveryStatus = ['attempted', 'sent', 'failed', 'unknown'].includes(String(p.status)) ? p.status as DeliveryStatus : 'unknown';
            if (state !== 'failed' || p.retryable !== true) {
              outcomes.push({ status: 'skipped', previousStatus: state, recipientHash: key.recipientHash, weekStart: period.startDate,
                ...(state !== 'sent' ? { code: 'manual_check_no_retry' } : {}) }); continue;
            }
          }
          if (!report || index > 0) report = await loadChefReport(pool, period, replyTo);
          if (clock() + SMTP_TIMEOUT_MS + 16000 > deadline) {
            outcomes.push({ status: 'failed', recipientHash: key.recipientHash, weekStart: period.startDate, code: 'sweep_budget_deferred_no_smtp' }); continue;
          }
          outcomes.push(await deliverChefReport(pool, report, period, options.mode === 'preview' ? 'preview' : 'live', to, env, deps.send,
            { now, retry: options.mode === 'live', existingOnly: index > 0 }));
        } catch {
          outcomes.push({ status: 'unknown', recipientHash: key.recipientHash, weekStart: period.startDate, code: 'target_processing_failed_manual_check_no_retry' });
        }
      }
      report = index === 0 ? report : undefined;
    }
    if (options.mode !== 'dry-run') console.info('[chef-report-sweep]', { outcomes });
    return { status: options.mode === 'dry-run' ? 'dry-run' as const : 'completed' as const, window, report, outcomes };
  } finally { if (ownedPool) await ownedPool.end(); }
}

export function deliveryFailed(outcome: DeliveryOutcome): boolean {
  return outcome.status !== 'sent' && !(outcome.status === 'skipped' && (outcome.previousStatus === 'sent' || outcome.code === 'no_failed_backlog'));
}
