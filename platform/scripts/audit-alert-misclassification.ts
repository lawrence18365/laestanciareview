/**
 * AUDITORÍA SOLO-LECTURA — reseñas accionables que se entregaron al GM como
 * buenas noticias.
 *
 *   npx tsx scripts/audit-alert-misclassification.ts
 *   npx tsx scripts/audit-alert-misclassification.ts --unit estancia-queretaro
 *   npx tsx scripts/audit-alert-misclassification.ts --limit 20
 *   npx tsx scripts/audit-alert-misclassification.ts --help
 *
 * Por qué existe
 * --------------
 * Hasta el fix, la alerta al GM decidía el sentimiento SOLO con las estrellas
 * (`review.rating < 4 ? 'low_review' : 'positive_review'`, ver ba94979). Toda
 * reseña de 4 o 5 estrellas se anunciaba como "⭐ Comentario positivo de N
 * estrellas" aunque el texto fuera una queja. src/lib/review-classification.ts
 * es la única fuente de verdad y clasifica también por texto.
 *
 * Este script lista, por unidad, las reseñas PASADAS donde
 * classifyReview().actionable === true pero el GM recibió el mensaje positivo.
 *
 * DOS poblaciones distintas, que NUNCA se suman
 * --------------------------------------------
 *   A. Mal clasificadas (secciones 1 y 2) — accionables que SÍ se entregaron al
 *      GM, pero como buenas noticias.
 *   B. Nunca avisadas (sección 3) — accionables que la compuerta vieja por
 *      estrellas descartó ANTES de que corriera cualquier canal, así que el GM
 *      no recibió nada: ni lo bueno ni lo malo. Es una falla distinta, y toda
 *      fila de esa sección es `inferred` (regla vieja), nunca verificada.
 *
 * Evidencia (nunca se presentan las dos como equivalentes)
 * --------------------------------------------------------
 *   verified  — existe una fila en push_notifications con kind='positive_review',
 *               subject_type='review' y subject_id = la reseña: evidencia directa
 *               de que se registró un push positivo para esa reseña. Ojo: la fila
 *               registra el ENVÍO, no la visualización en el dispositivo.
 *   inferred  — no hay push positivo registrado (o no existe la tabla), así que
 *               la pertenencia se deduce de la regla vieja: actionable && rating >= 4.
 *
 * Una fila 'inferred' NO es un hecho verificado. No la presentes como tal.
 *
 * Solo lectura, de verdad
 * -----------------------
 * Todas las consultas son SELECT y se ejecutan dentro de una transacción
 * READ ONLY, así que un UPDATE/INSERT/DELETE/DDL accidental falla en el motor
 * en lugar de dañar datos. Además assertReadOnly() rechaza cualquier sentencia
 * que no empiece con SELECT/WITH antes de mandarla.
 *
 * El dueño fue explícito: "no reescriban la historia, solo necesito la lista
 * para saber qué ir a revisar". Nada aquí escribe.
 */
import { config } from 'dotenv';
// Quiet antes de cargar: el banner de dotenv va a stdout y ensucia la salida.
process.env.DOTENV_CONFIG_QUIET ??= 'true';
config({ path: process.env.ENV_FILE ?? '.env.local', quiet: true });

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;

import { classifyReview } from '@/lib/review-classification';
import type { ReviewSeverity } from '@/lib/review-classification';

const MX_TZ = 'America/Mexico_City';
const FEEDBACK_PREVIEW_CHARS = 200;

// ── Argumentos ──────────────────────────────────────────────────────────────

interface Args {
  unit?: string;
  limit?: number;
  help: boolean;
}

class ArgError extends Error {}

function parseArgs(argv: string[]): Args {
  const help = argv.includes('--help') || argv.includes('-h');
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      throw new ArgError(`--${name} requiere un valor`);
    }
    return v;
  };

  const unit = get('unit');
  if (unit !== undefined && !/^[a-z0-9-]{1,100}$/.test(unit)) {
    throw new ArgError(
      `--unit "${unit}" no es un slug válido (minúsculas, dígitos y guiones)`,
    );
  }

  const rawLimit = get('limit');
  let limit: number | undefined;
  if (rawLimit !== undefined) {
    if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
      throw new ArgError(`--limit "${rawLimit}" debe ser un entero >= 1`);
    }
    limit = Number(rawLimit);
  }

  const known = new Set(['--unit', '--limit', '--help', '-h']);
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('-')) continue;
    if (!known.has(token)) throw new ArgError(`argumento desconocido: ${token}`);
    if (token === '--unit' || token === '--limit') i++;
  }

  return { unit, limit, help };
}

const USAGE = `Auditoría SOLO-LECTURA: reseñas accionables entregadas al GM como positivas.

  npx tsx scripts/audit-alert-misclassification.ts [opciones]

Opciones
  --unit <slug>   Solo una unidad (slug de restaurants.slug). Por defecto: todas.
  --limit N       Máximo de filas en el detalle (el resumen sigue siendo completo).
  --help, -h      Esta ayuda.

No escribe nada. Todas las consultas son SELECT en una transacción READ ONLY.`;

// ── La compuerta vieja por estrellas (solo para inferir, nunca ejecutada) ───

/**
 * Reproducción EXACTA de la compuerta que corría antes del fix, tal como estaba
 * en src/lib/feedback-alerts.ts (commit 5f82b6b). Vive aquí solo para poder
 * inferir qué reseñas NUNCA llegaron al GM; no decide nada en producción.
 *
 *   'all'       -> siempre se enviaba
 *   'low'       -> solo cuando rating <= 2
 *   'threshold' -> solo cuando rating < google_threshold
 *   'off'       -> nunca
 *   (cualquier otro valor) -> nunca
 */
function oldGateWouldSend(
  preference: string | null,
  rating: number,
  threshold: number,
): boolean {
  const pref = preference ?? 'all';
  if (pref === 'all') return true;
  if (pref === 'low') return rating <= 2;
  if (pref === 'threshold') return rating < threshold;
  return false; // 'off'
}

// ── Acceso a datos (select-only, transacción read only) ─────────────────────

const WRITE_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|merge|call|copy|vacuum|reindex|cluster|refresh)\b/i;

/** Rechaza cualquier sentencia que no sea un SELECT/WITH de lectura. */
function assertReadOnly(sql: string): void {
  const head = sql.trim().replace(/^(--[^\n]*\n|\s)+/g, '');
  if (!/^(select|with)\b/i.test(head)) {
    throw new Error(`sentencia no permitida (solo SELECT): ${head.slice(0, 60)}…`);
  }
  const body = sql.replace(/--[^\n]*/g, ' ');
  // El primer keyword de escritura permitido: `for update` no se usa aquí.
  const forbidden = body.match(WRITE_KEYWORDS);
  if (forbidden) {
    throw new Error(`sentencia no permitida (contiene "${forbidden[0]}"): solo SELECT`);
  }
  if (/;\s*\S/.test(body)) {
    throw new Error('sentencia no permitida: múltiples statements en un solo query');
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL missing');
  const dbHost = (() => {
    try {
      return new URL(url).host;
    } catch {
      return '(host no parseable)';
    }
  })();

  const pool = new Pool({ connectionString: url });

  /**
   * Ejecuta un SELECT dentro de `BEGIN TRANSACTION READ ONLY`. Si algo intentara
   * escribir, Postgres lo rechaza: la garantía no depende de nuestra disciplina.
   */
  const select = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
    assertReadOnly(sql);
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION READ ONLY');
      const result = await client.query(sql, params);
      await client.query('COMMIT');
      return result.rows as T[];
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* la conexión ya está rota; el error original importa más */
      }
      throw error;
    } finally {
      client.release();
    }
  };

  try {
    // 1. ¿Existe la evidencia directa? (push_notifications con kind/subject)
    const probe = await select<{
      table_exists: boolean;
      has_kind: boolean;
      has_subject_type: boolean;
      has_subject_id: boolean;
    }>(`
      SELECT
        (to_regclass('public.push_notifications') IS NOT NULL) AS table_exists,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'push_notifications'
                   AND column_name = 'kind') AS has_kind,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'push_notifications'
                   AND column_name = 'subject_type') AS has_subject_type,
        EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'push_notifications'
                   AND column_name = 'subject_id') AS has_subject_id`);

    const p = probe[0];
    const hasPushEvidence = Boolean(
      p?.table_exists && p.has_kind && p.has_subject_type && p.has_subject_id,
    );

    // 2. Reseñas con texto, por unidad real (excluye cuentas owner/regional,
    //    igual que getOverdueComplaints en src/lib/complaint-sla.ts).
    const positiveJoin = hasPushEvidence
      ? `LEFT JOIN (
           SELECT DISTINCT subject_id AS review_id
           FROM push_notifications
           WHERE kind = 'positive_review'
             AND subject_type = 'review'
             AND subject_id IS NOT NULL
         ) pp ON pp.review_id = r.id`
      : '';
    const positiveColumn = hasPushEvidence
      ? `(pp.review_id IS NOT NULL) AS positive_push_recorded`
      : `false AS positive_push_recorded`;

    const unitClause = args.unit ? 'AND rest.slug = $1' : '';
    const params: unknown[] = args.unit ? [args.unit] : [];

    const rows = await select<{
      id: number;
      restaurant_id: number;
      restaurant_name: string;
      restaurant_slug: string;
      rating: number;
      feedback: string;
      status: string;
      created_at: Date | string | null;
      reviewed_at: Date | string | null;
      resolved_at: Date | string | null;
      alert_sent_at: Date | string | null;
      alert_channels: unknown;
      staff_name: string | null;
      positive_push_recorded: boolean;
      alert_preference: string | null;
      google_threshold: number;
    }>(
      `
      SELECT
        r.id,
        r.restaurant_id,
        rest.name  AS restaurant_name,
        rest.slug  AS restaurant_slug,
        r.rating,
        r.feedback,
        r.status::text AS status,
        r.created_at,
        r.reviewed_at,
        r.resolved_at,
        r.alert_sent_at,
        r.alert_channels,
        r.staff_name,
        rest.alert_preference AS alert_preference,
        rest.google_threshold AS google_threshold,
        ${positiveColumn}
      FROM reviews r
      INNER JOIN restaurants rest ON rest.id = r.restaurant_id
      ${positiveJoin}
      WHERE r.feedback IS NOT NULL
        AND btrim(r.feedback) <> ''
        AND rest.is_owner = false
        AND rest.is_regional = false
        ${unitClause}
      ORDER BY rest.name, r.created_at, r.id`,
      params,
    );

    if (args.unit && rows.length === 0) {
      // Distinguir "esa unidad no tiene reseñas con texto" de "ese slug no existe".
      const exists = await select<{ slug: string }>(
        `SELECT slug FROM restaurants WHERE slug = $1`,
        [args.unit],
      );
      if (exists.length === 0) {
        throw new Error(`--unit "${args.unit}": no existe ninguna unidad con ese slug`);
      }
    }

    // 3. Clasificar retroactivamente y separar las mal clasificadas.
    type Evidence = 'verified' | 'inferred';

    interface Judged {
      row: (typeof rows)[number];
      severity: ReviewSeverity;
      signals: string[];
      actionable: boolean;
      evidence: Evidence | null;
      /**
       * La compuerta vieja por estrellas descartaba esta reseña, así que ningún
       * canal corrió para ella. Es una inferencia a partir de la regla vieja
       * (preferencia + umbral de la unidad), NUNCA una entrega registrada.
       */
      gateDropped: boolean;
    }

    const judged: Judged[] = rows.map((row) => {
      const classification = classifyReview({
        rating: row.rating,
        feedback: row.feedback,
      });
      const actionable = classification.actionable;
      const verified = actionable && row.positive_push_recorded === true;
      const inferred = actionable && !verified && row.rating >= 4;
      return {
        row,
        severity: classification.severity,
        signals: classification.signals,
        actionable,
        evidence: verified ? 'verified' : inferred ? 'inferred' : null,
        gateDropped: !oldGateWouldSend(
          row.alert_preference,
          row.rating,
          row.google_threshold,
        ),
      };
    });

    const misclassified = judged.filter((j) => j.evidence !== null);
    // Accionables que la compuerta vieja dejó fuera: el GM no supo de ellas.
    const neverAlerted = judged.filter((j) => j.gateDropped && j.actionable);
    const units = aggregate(judged, misclassified);

    printHeader({
      dbHost,
      hasPushEvidence,
      unit: args.unit,
      limit: args.limit,
      scanned: rows.length,
    });

    if (rows.length === 0) {
      console.log('\nNo hay reseñas con texto en el alcance de esta auditoría.');
      console.log('Nada que revisar. (Sin cambios en la base de datos.)');
      return;
    }

    printUnitSummary(units, misclassified);
    printDetail(misclassified, args.limit);
    printNeverAlerted(units, neverAlerted, args.limit);
    printTotals(judged, misclassified, neverAlerted, units, rows.length);
  } finally {
    await pool.end();
  }
}

// ── Agregación ──────────────────────────────────────────────────────────────

interface JudgedRow {
  row: {
    id: number;
    restaurant_name: string;
    restaurant_slug: string;
    created_at: Date | string | null;
    rating: number;
    reviewed_at: Date | string | null;
    resolved_at: Date | string | null;
    status: string;
    feedback: string;
    staff_name: string | null;
    alert_channels: unknown;
    alert_preference: string | null;
    google_threshold: number;
  };
  severity: ReviewSeverity;
  signals: string[];
  actionable: boolean;
  evidence: 'verified' | 'inferred' | null;
  gateDropped: boolean;
}

interface UnitSummary {
  name: string;
  slug: string;
  /** Preferencia de alertas de la unidad: 'all' | 'low' | 'threshold' | 'off'. */
  preference: string | null;
  /** Umbral de Google, el corte que usaba la preferencia 'threshold'. */
  threshold: number;
  withText: number;
  actionable: number;
  verified: number;
  inferred: number;
  unresolved: number;
  /** Reseñas con texto que la compuerta vieja dejó fuera. */
  gateDropped: number;
  /** De esas, las que classifyReview() marca accionables. */
  gateDroppedActionable: number;
  first: Date | null;
  last: Date | null;
}

function isUnresolved(row: JudgedRow['row']): boolean {
  return row.status !== 'resolved';
}

function aggregate(judged: JudgedRow[], misclassified: JudgedRow[]): UnitSummary[] {
  const bySlug = new Map<string, UnitSummary>();

  const bucket = (slug: string, name: string): UnitSummary => {
    let unit = bySlug.get(slug);
    if (!unit) {
      unit = {
        name,
        slug,
        preference: null,
        threshold: 0,
        withText: 0,
        actionable: 0,
        verified: 0,
        inferred: 0,
        unresolved: 0,
        gateDropped: 0,
        gateDroppedActionable: 0,
        first: null,
        last: null,
      };
      bySlug.set(slug, unit);
    }
    return unit;
  };

  for (const j of judged) {
    const unit = bucket(j.row.restaurant_slug, j.row.restaurant_name);
    unit.withText += 1;
    unit.preference = j.row.alert_preference ?? 'all';
    unit.threshold = j.row.google_threshold;
    if (j.actionable) unit.actionable += 1;
    if (j.gateDropped) {
      unit.gateDropped += 1;
      if (j.actionable) unit.gateDroppedActionable += 1;
    }
    const at = toDate(j.row.created_at);
    if (at) {
      if (!unit.first || at < unit.first) unit.first = at;
      if (!unit.last || at > unit.last) unit.last = at;
    }
  }

  for (const j of misclassified) {
    const unit = bucket(j.row.restaurant_slug, j.row.restaurant_name);
    if (j.evidence === 'verified') unit.verified += 1;
    else unit.inferred += 1;
    if (isUnresolved(j.row)) unit.unresolved += 1;
  }

  return [...bySlug.values()].sort((a, b) => {
    const ma = a.verified + a.inferred;
    const mb = b.verified + b.inferred;
    if (mb !== ma) return mb - ma;
    return a.name.localeCompare(b.name, 'es');
  });
}

// ── Fechas en America/Mexico_City ───────────────────────────────────────────

const MX_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: MX_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'YYYY-MM-DD HH:mm' hora de Ciudad de México (las 12 unidades son UTC-6). */
function fmtMxDateTime(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const parts: Record<string, string> = {};
  for (const part of MX_PARTS.formatToParts(d)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function fmtMxDate(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const parts: Record<string, string> = {};
  for (const part of MX_PARTS.formatToParts(d)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// ── Impresión ───────────────────────────────────────────────────────────────

const RULE = '─'.repeat(104);

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Canales que realmente se entregaron (alert_channels[key].ok === true). */
function deliveredChannels(alertChannels: unknown): string {
  if (!alertChannels || typeof alertChannels !== 'object') return '—';
  const ok = Object.entries(alertChannels as Record<string, unknown>)
    .filter(([, v]) => Boolean((v as { ok?: boolean } | null)?.ok))
    .map(([k]) => k);
  return ok.length > 0 ? ok.join(', ') : '—';
}

interface Column {
  header: string;
  align?: 'left' | 'right';
}

function renderTable(columns: Column[], rows: string[][]): string[] {
  const widths = columns.map((col, i) =>
    Math.max(col.header.length, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, i) => {
        const width = widths[i];
        const text = cell ?? '';
        return columns[i].align === 'right'
          ? text.padStart(width)
          : text.padEnd(width);
      })
      .join('  ')
      .replace(/\s+$/, '');
  return [
    line(columns.map((c) => c.header)),
    widths.map((w) => '─'.repeat(w)).join('  '),
    ...rows.map(line),
  ];
}

function printHeader(info: {
  dbHost: string;
  hasPushEvidence: boolean;
  unit?: string;
  limit?: number;
  scanned: number;
}): void {
  console.log('');
  console.log('═'.repeat(104));
  console.log(' AUDITORÍA SOLO-LECTURA · reseñas accionables entregadas al GM como positivas');
  console.log('═'.repeat(104));
  console.log('');
  console.log('  • NO se modificó ningún registro. Todas las consultas son SELECT y corren');
  console.log('    dentro de BEGIN TRANSACTION READ ONLY: la base rechazaría cualquier');
  console.log('    escritura. Esta es una lista para ir a revisar, no una corrección.');
  console.log('  • La clasificación de src/lib/review-classification.ts se aplica DE FORMA');
  console.log('    RETROACTIVA a reseñas que se entregaron bajo las reglas viejas, cuando');
  console.log('    el sentimiento se deducía solo de las estrellas (rating >= 4 =>');
  console.log('    "⭐ Comentario positivo de N estrellas"). Nada se reenvió.');
  console.log('');
  console.log('  Evidencia por fila (nunca se mezclan):');
  if (info.hasPushEvidence) {
    console.log('    verified = existe una fila en push_notifications con');
    console.log("               kind='positive_review' y subject = esa reseña.");
    console.log('               Evidencia directa de que se REGISTRÓ el push positivo');
    console.log('               (registra el envío, no que el dispositivo lo mostrara).');
  } else {
    console.log('    verified = no aplica: no hay tabla push_notifications con');
    console.log('               kind/subject_type/subject_id en esta base. Ninguna fila');
    console.log('               puede etiquetarse como verificada.');
  }
  console.log('    inferred = no hay push positivo registrado; se deduce de la regla vieja');
  console.log('               (actionable && rating >= 4). Una fila inferred NO es un hecho');
  console.log('               verificado.');
  console.log('    Ausencia de fila no prueba ausencia de aviso: la tabla empieza el');
  console.log('    2026-08-21 y no hay fila cuando el push no estaba configurado. Por eso');
  console.log('    las filas antiguas se reportan como inferred y no como verified.');
  console.log('');
  console.log(`  Base de datos: ${info.dbHost}`);
  console.log(`  Unidad:        ${info.unit ?? 'todas (sin --unit)'}`);
  console.log(`  Límite detalle:${info.limit !== undefined ? ` ${info.limit}` : ' sin límite'}`);
  console.log(`  Reseñas con texto revisadas: ${info.scanned}`);
  console.log(`  Zona horaria:  ${MX_TZ}`);
  console.log('');
}

function printUnitSummary(units: UnitSummary[], misclassified: JudgedRow[]): void {
  console.log(RULE);
  console.log(' 1. RESUMEN POR UNIDAD');
  console.log(RULE);
  console.log('');

  const columns: Column[] = [
    { header: 'Unidad' },
    { header: 'Reseñas c/texto', align: 'right' },
    { header: 'Accionables', align: 'right' },
    { header: 'Mal clasif.', align: 'right' },
    { header: 'verified', align: 'right' },
    { header: 'inferred', align: 'right' },
    { header: 'Sin resolver', align: 'right' },
    { header: 'Rango (fecha de la reseña)' },
  ];

  const rows = units.map((u) => [
    u.name,
    String(u.withText),
    String(u.actionable),
    String(u.verified + u.inferred),
    String(u.verified),
    String(u.inferred),
    String(u.unresolved),
    `${fmtMxDate(u.first)} → ${fmtMxDate(u.last)}`,
  ]);

  for (const line of renderTable(columns, rows)) console.log(line);

  console.log('');
  console.log('  "Mal clasif." = accionables que el GM recibió como positivas.');
  console.log('  "Sin resolver" = de esas mal clasificadas, status <> \'resolved\'.');
  console.log('  "Rango" cubre todas las reseñas con texto de esa unidad, no solo las mal');
  console.log('   clasificadas.');
  if (misclassified.length === 0) {
    console.log('');
    console.log('  Ninguna reseña quedó marcada como mal clasificada.');
  }
}

function printDetail(misclassified: JudgedRow[], limit?: number): void {
  if (misclassified.length === 0) return;

  const shown = limit !== undefined ? misclassified.slice(0, limit) : misclassified;

  console.log('');
  console.log(RULE);
  console.log(' 2. DETALLE DE RESEÑAS MAL CLASIFICADAS');
  if (limit !== undefined && misclassified.length > shown.length) {
    console.log(`    (mostrando ${shown.length} de ${misclassified.length} por --limit ${limit})`);
  }
  console.log(RULE);

  let currentUnit: string | null = null;
  for (const j of shown) {
    const { row } = j;
    if (row.restaurant_name !== currentUnit) {
      currentUnit = row.restaurant_name;
      console.log('');
      console.log(`▼ ${currentUnit}  [${row.restaurant_slug}]`);
    }
    const evidenceLabel =
      j.evidence === 'verified'
        ? 'verified (push positivo registrado)'
        : 'inferred (regla vieja rating >= 4)';

    console.log('');
    console.log(`  [#${row.id}] ${fmtMxDateTime(row.created_at)} · ${row.rating}★ · ${row.status}`);
    console.log(`    evidencia : ${evidenceLabel}`);
    console.log(`    severidad : ${j.severity}`);
    console.log(`    señales   : ${j.signals.length > 0 ? j.signals.join(', ') : '(ninguna)'}`);
    console.log(
      `    mesero    : ${row.staff_name ?? '—'}   canales entregados: ${deliveredChannels(row.alert_channels)}`,
    );
    console.log(`    revisada  : ${fmtMxDateTime(row.reviewed_at)}   resuelta: ${fmtMxDateTime(row.resolved_at)}`);
    console.log(`    texto     : "${truncate(row.feedback, FEEDBACK_PREVIEW_CHARS)}"`);
  }

  if (limit !== undefined && misclassified.length > shown.length) {
    console.log('');
    console.log(
      `  … ${misclassified.length - shown.length} filas más omitidas por --limit ${limit}.`,
    );
  }
}

// ── Sección 3: los que la compuerta vieja nunca dejó salir ──────────────────

/**
 * Tercera sección del informe. A diferencia de la sección 2, aquí TODA fila es
 * `inferred`: no existe —ni puede existir— un registro de entrega, porque la
 * compuerta por estrellas descartaba la reseña antes de que corriera un canal.
 * Cada fila lleva la etiqueta `inferred` y la regla que la produce; nada se
 * presenta como verificado.
 */
function printNeverAlerted(
  units: UnitSummary[],
  neverAlerted: JudgedRow[],
  limit?: number,
): void {
  console.log('');
  console.log(RULE);
  console.log(' 3. NUNCA AVISADAS · la compuerta vieja por estrellas las dejó fuera');
  console.log(RULE);
  console.log('');
  console.log('  TODA fila de esta sección es `inferred`. Se deduce de la REGLA VIEJA');
  console.log('  (alert_preference + rating <= 2 / rating < google_threshold) aplicada a');
  console.log('  cada unidad, NO de una entrega registrada. Ninguna fila está verificada');
  console.log('  y ninguna se presenta como tal.');
  console.log('');
  console.log('  Es una falla DISTINTA a la de las secciones 1 y 2: allí el GM recibió la');
  console.log('  reseña como buenas noticias; aquí no recibió nada, ni lo bueno ni lo');
  console.log('  malo, porque la compuerta la descartó antes de que corriera un canal.');
  console.log('  Las dos cifras no se suman.');
  console.log('');

  const ordered = [...units].sort((a, b) => {
    if (b.gateDroppedActionable !== a.gateDroppedActionable) {
      return b.gateDroppedActionable - a.gateDroppedActionable;
    }
    if (b.gateDropped !== a.gateDropped) return b.gateDropped - a.gateDropped;
    return a.name.localeCompare(b.name, 'es');
  });

  const columns: Column[] = [
    { header: 'Unidad' },
    { header: 'Preferencia' },
    { header: 'Umbral', align: 'right' },
    { header: 'Reseñas c/texto', align: 'right' },
    { header: 'Omitidas', align: 'right' },
    { header: 'Accionables omitidas', align: 'right' },
  ];

  const tableRows = ordered.map((u) => [
    u.name,
    u.preference ?? 'all',
    String(u.threshold),
    String(u.withText),
    String(u.gateDropped),
    String(u.gateDroppedActionable),
  ]);

  for (const line of renderTable(columns, tableRows)) console.log(line);

  console.log('');
  console.log("  \"Preferencia\"/\"Umbral\" = configuración ACTUAL de la unidad (la compuerta");
  console.log('   vieja se aplica con estos valores, así que la inferencia es una');
  console.log('   reconstrucción, no un registro de lo que pasó en su momento).');
  console.log('  "Omitidas" = reseñas con texto que la compuerta vieja no habría enviado');
  console.log("   a NINGÚN canal ('all' nunca omite; 'off' omite todo).");
  console.log('  "Accionables omitidas" = de esas omitidas, las que classifyReview() marca');
  console.log('   accionables. Son la población del detalle de abajo.');
  console.log('');
  console.log('  "canales entregados" en el detalle muestra lo que alert_channels contiene');
  console.log('  HOY; como esta inferencia es sobre la regla ANTERIOR, cualquier canal');
  console.log('  listado ahí viene de un camino posterior (p. ej. la escalada nueva), no de');
  console.log('  la alerta que la compuerta bloqueó.');

  if (neverAlerted.length === 0) {
    console.log('');
    console.log('  Ninguna reseña accionable quedó fuera de su compuerta.');
    return;
  }

  const shown = limit !== undefined ? neverAlerted.slice(0, limit) : neverAlerted;

  console.log('');
  console.log(RULE);
  console.log(' 3b. DETALLE DE RESEÑAS ACCIONABLES NUNCA AVISADAS (todas inferred)');
  if (limit !== undefined && neverAlerted.length > shown.length) {
    console.log(`    (mostrando ${shown.length} de ${neverAlerted.length} por --limit ${limit})`);
  }
  console.log(RULE);

  let currentUnit: string | null = null;
  for (const j of shown) {
    const { row } = j;
    if (row.restaurant_name !== currentUnit) {
      currentUnit = row.restaurant_name;
      console.log('');
      console.log(`▼ ${currentUnit}  [${row.restaurant_slug}]`);
    }
    // Siempre `inferred`, nunca `verified`: no hay entrega que registrar.
    const evidenceLabel =
      `inferred (compuerta vieja: pref '${row.alert_preference ?? 'all'}', `
      + `umbral ${row.google_threshold} — nunca se envió)`;

    console.log('');
    console.log(`  [#${row.id}] ${fmtMxDateTime(row.created_at)} · ${row.rating}★ · ${row.status}`);
    console.log(`    evidencia : ${evidenceLabel}`);
    console.log(`    severidad : ${j.severity}`);
    console.log(`    señales   : ${j.signals.length > 0 ? j.signals.join(', ') : '(ninguna)'}`);
    console.log(
      `    mesero    : ${row.staff_name ?? '—'}   canales entregados: ${deliveredChannels(row.alert_channels)}`,
    );
    console.log(`    revisada  : ${fmtMxDateTime(row.reviewed_at)}   resuelta: ${fmtMxDateTime(row.resolved_at)}`);
    console.log(`    texto     : "${truncate(row.feedback, FEEDBACK_PREVIEW_CHARS)}"`);
  }

  if (limit !== undefined && neverAlerted.length > shown.length) {
    console.log('');
    console.log(
      `  … ${neverAlerted.length - shown.length} filas más omitidas por --limit ${limit}.`,
    );
  }
}

function printTotals(
  judged: JudgedRow[],
  misclassified: JudgedRow[],
  neverAlerted: JudgedRow[],
  units: UnitSummary[],
  scanned: number,
): void {
  const verified = misclassified.filter((j) => j.evidence === 'verified').length;
  const inferred = misclassified.length - verified;
  const actionable = judged.filter((j) => j.actionable).length;
  const unresolved = misclassified.filter((j) => isUnresolved(j.row)).length;
  const gateDropped = judged.filter((j) => j.gateDropped).length;
  const neverAlertedUnresolved = neverAlerted.filter((j) => isUnresolved(j.row)).length;
  // Filas que aparecen en las dos listas: la regla gruesa de la sección 2
  // (actionable && rating >= 4) no distinguía la compuerta de cada unidad.
  const inBoth = neverAlerted.filter((j) => j.evidence !== null).length;

  console.log('');
  console.log(RULE);
  console.log(' 4. TOTAL GENERAL — dos fallas distintas, reportadas por separado');
  console.log(RULE);
  console.log(`  Unidades con reseñas con texto : ${units.length}`);
  console.log(`  Reseñas con texto revisadas    : ${scanned}`);
  console.log(`  Reseñas accionables            : ${actionable}`);
  console.log('');
  console.log('  Falla A — accionables entregadas al GM como positivas (secciones 1 y 2)');
  console.log(`      Total                      : ${misclassified.length}`);
  console.log(`          verified               : ${verified}`);
  console.log(`          inferred               : ${inferred}`);
  console.log(`      De ellas, sin resolver     : ${unresolved}`);
  console.log('');
  console.log('  Falla B — accionables nunca avisadas, la compuerta las descartó (sección 3)');
  console.log(`      Total                      : ${neverAlerted.length}`);
  console.log(`          verified               : 0   (no puede haber: no hubo entrega)`);
  console.log(`          inferred               : ${neverAlerted.length}`);
  console.log(`      De ellas, sin resolver     : ${neverAlertedUnresolved}`);
  console.log(`      (contexto: reseñas con texto que la compuerta vieja omitió: ${gateDropped})`);
  console.log('');
  console.log('  Las dos cifras NO se suman: son fallas distintas.');
  if (inBoth > 0) {
    console.log(`  ${inBoth} reseña(s) aparecen en las dos listas. Las que ahí son \`inferred\``);
    console.log('  lo están por la regla gruesa de la sección 2 (actionable && rating >= 4),');
    console.log('  que no conocía la compuerta; con la regla precisa nunca se enviaron, así');
    console.log('  que su falla real es la B.');
  }
  console.log('');
  console.log('  Recordatorio: solo lectura. Ningún registro fue modificado y ninguna');
  console.log('  reseña fue reclasificada en la base; esta clasificación es retroactiva y');
  console.log('  vive únicamente en esta salida.');
  console.log('');
}

main().catch((error) => {
  console.error('Error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
