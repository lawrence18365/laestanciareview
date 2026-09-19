/**
 * Canonical review classification.
 *
 * This module exists because of Harbor's Angelopolis review #28768 (16 sep
 * 2026, 18:28 Mexico City). A 4-star review whose text read
 *
 *   "Pedimos la sopa de mariscos y estaba realmente mala, no tenia sabor,
 *    creo que si deberia cuidar mas la calidad de los alimentos.
 *    El servicio excelente!"
 *
 * reached the GM as "⭐ Comentario positivo de 4 estrellas" (kind
 * positive_review) while the owner and the regional manager received
 * "⚠️ Harbor's Angelopolis: 4 estrellas" (kind low_review) for the same row.
 * The person who could have fixed the soup was told it was good news; the
 * people who could not were told it was a problem.
 *
 * Two defects produced that:
 *
 *   1. Sentiment was inferred from the star count alone (POSITIVE_RATING_MIN),
 *      so any 4-star was "positivo" regardless of what the guest wrote.
 *   2. Nothing was shared between the GM branch and the escalation branch, so
 *      they could disagree — and on 4-star reviews they always did, because the
 *      escalation branch hardcoded the warning wording.
 *
 * Every recipient of a given review now derives its wording, colour, push kind
 * and inbox placement from one call to classifyReview(). If two recipients ever
 * disagree again it is a bug in this module, not in a copy of the rules.
 *
 * Design constraints:
 *
 *   - Dependency-free and browser-safe. FeedbackInbox.tsx is a 'use client'
 *     component; commit 439f6ab was a four-day production outage caused by a
 *     client component importing a module that reached @/db. Nothing here may
 *     import the database, env vars or any server-only module.
 *   - Deterministic and synchronous. This runs inside the alert hot path, which
 *     today completes in roughly a second. A model call here would add a network
 *     failure mode and a per-review cost to a path that must not silently
 *     degrade; the severity of a complaint cannot depend on an API being up.
 *     classifyReview() is the seam where a model-assisted pass can be added
 *     later without touching any caller.
 *   - Explainable. `signals` reports which detectors fired so a surprising
 *     classification can be traced instead of guessed at.
 *
 * Language: the guest-facing app is Spanish-only (es-MX), so the lexicons are
 * Spanish. Text is accent-folded before matching, because guests type on phone
 * keyboards and "no tenia sabor" is as common as "no tenía sabor".
 */

/**
 * Ordered least to most serious. `mixed` sits above `praise` because a review
 * that contains anything actionable must never be presented as good news.
 */
export type ReviewSeverity = 'praise' | 'mixed' | 'complaint' | 'urgent';

/** Star-count bucket. Kept separate from severity on purpose — see feedback.ts. */
export type RatingBucket = 'positive' | 'low';

export interface ReviewClassification {
  severity: ReviewSeverity;
  /** True when a human needs to do something. Drives the inbox split. */
  actionable: boolean;
  /** Legacy star bucket, unchanged. Never used to infer sentiment. */
  ratingBucket: RatingBucket;
  /** Which detectors fired, for debugging and for the audit trail. */
  signals: string[];
}

export interface ClassifyReviewInput {
  rating: number;
  feedback: string | null | undefined;
}

/** At or below this rating a review is urgent no matter how kind the text is. */
export const URGENT_MAX_RATING = 2;

/** Below this rating a review is never presented as praise. */
export const COMPLAINT_MAX_RATING = 3;

const SEVERITY_ORDER: Record<ReviewSeverity, number> = {
  praise: 0,
  mixed: 1,
  complaint: 2,
  urgent: 3,
};

/** Returns whichever severity is more serious. */
export function maxSeverity(a: ReviewSeverity, b: ReviewSeverity): ReviewSeverity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

/**
 * Lowercase, strip diacritics, normalise punctuation to spaces, collapse runs.
 * Leading/trailing spaces are kept as word guards so `\b`-free matching on
 * " word " stays exact.
 */
export function normalizeText(input: string): string {
  const folded = input
    .toLowerCase()
    .normalize('NFD')
    // Written as \u escapes, not the literal combining marks: a tool that
    // re-normalises or re-encodes this file could reattach or drop raw marks,
    // silently killing accent folding ("no tenía sabor" would stop matching).
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return folded.length > 0 ? ` ${folded} ` : '';
}

/**
 * Negative descriptors, grouped by the operational domain a GM would act on.
 * Grouping is deliberate: it keeps the list reviewable by a human, makes the
 * emitted signal name meaningful ("food_quality" rather than "keyword_17"), and
 * makes it obvious where a new term belongs. These are matched as whole words.
 */
const NEGATIVE_LEXICON: Record<string, string[]> = {
  food_quality: [
    'mala', 'malo', 'malas', 'malos', 'pesima', 'pesimo', 'pesimas', 'pesimos',
    'horrible', 'horribles', 'asqueroso', 'asquerosa', 'incomible',
    'desabrido', 'desabrida', 'deshabrido', 'deshabrida', 'insipido', 'insipida',
    'simple', 'seco', 'seca', 'duro', 'dura', 'chiclosa', 'chicloso',
    'quemado', 'quemada', 'crudo', 'cruda', 'grasoso', 'grasosa',
    'salado', 'salada', 'salado', 'soso', 'sosa', 'aguado', 'aguada',
    'echado', 'echada', 'rancio', 'rancia', 'agrio', 'agria',
  ],
  temperature: ['frio', 'fria', 'frios', 'frias', 'tibio', 'tibia', 'helada', 'helado'],
  wait: [
    'tardaron', 'tardo', 'tarde', 'lento', 'lenta', 'lentos', 'lentas',
    'demora', 'demoro', 'demoraron', 'espera', 'esperamos', 'esperar',
    'eterno', 'eterna', 'nunca llego', 'nunca llegaron',
  ],
  service: [
    'grosero', 'grosera', 'groseros', 'groseras', 'prepotente', 'prepotentes',
    'descortes', 'indiferente', 'ignoro', 'ignoraron', 'ignorados',
    'desatento', 'desatenta', 'pesimo servicio', 'mal servicio',
    'mala actitud', 'nos ignoraron',
  ],
  cleanliness: [
    'sucio', 'sucia', 'sucios', 'sucias', 'mugre', 'mugroso', 'mugrosa',
    'cochino', 'cochina', 'pelo', 'cabello', 'insecto', 'mosca', 'moscas',
    'cucaracha', 'cucarachas',
  ],
  price: ['caro', 'cara', 'caros', 'caras', 'carisimo', 'carisima', 'robo', 'estafa'],
  general: [
    'decepcion', 'decepcionante', 'decepcionados', 'decepcionada', 'decepcionado',
    'incomodo', 'incomoda', 'molesto', 'molesta', 'molestos',
    'queja', 'quejas', 'reclamo', 'error', 'equivocaron', 'equivoco',
    'no volvere', 'no volveremos', 'no recomiendo', 'nunca mas',
  ],
};

/**
 * Negated-positive patterns. "no tenia sabor" contains no negative word at all —
 * the complaint lives in the negation. Each entry is a negator followed, within
 * a short window, by a word that would otherwise be neutral or good.
 */
const NEGATORS = ['no', 'sin', 'nada', 'ni', 'tampoco', 'falto', 'falta', 'faltaba'];

const NEGATABLE_POSITIVES = [
  // Qualities a guest expects to be present.
  'sabor', 'sabroso', 'sazon', 'rico', 'rica', 'bueno', 'buena', 'buenos', 'buenas',
  'fresco', 'fresca', 'caliente', 'limpio', 'limpia', 'amable', 'atento', 'atenta',
  'recomendable', 'calidad', 'suficiente', 'completo', 'completa', 'bien',
  // Competence and fulfilment. "no saben prepararla" carries no negative
  // adjective at all — the whole complaint is in the negated verb.
  'saben', 'sabe', 'supieron', 'pudieron', 'quisieron', 'sirvieron', 'sirven',
  'trajeron', 'trajo', 'llego', 'llegaron', 'atendieron', 'atienden',
  'cumplieron', 'respetaron', 'avisaron', 'volvere', 'volveremos',
  'gusto', 'gusta', 'gustaron', 'agrado',
];

/**
 * Words after which a negator does NOT create a complaint, because the sentence
 * is praising an absence. "sin duda excelente", "no hay queja", "sin problema".
 */
const NEGATION_EXCEPTIONS = [
  'duda', 'queja', 'quejas', 'problema', 'problemas', 'falla', 'fallas',
  'espera', 'demora', 'comparacion', 'pero',
];

/** How many words after a negator still count as negated. */
const NEGATION_WINDOW = 3;

/**
 * Per-negator overrides. "nada" is the answer guests give to "anything we could
 * improve?", so "nada, todo bien" and "nada, todo muy rico" are praise, not
 * complaints. Restricting it to the word immediately after keeps the genuine
 * use ("nada bueno", "nada rico") working.
 */
const NEGATOR_WINDOW: Record<string, number> = { nada: 1 };

function windowFor(negator: string): number {
  return NEGATOR_WINDOW[negator] ?? NEGATION_WINDOW;
}

/**
 * Negators for *suppression* — a superset of NEGATORS, because "ninguna queja"
 * and "jamas" cancel a following word without forming the negated-positive
 * pattern themselves.
 */
const SUPPRESSING_NEGATORS = [
  ...NEGATORS,
  'ninguna', 'ningun', 'ninguno', 'ningunas', 'ningunos', 'jamas', 'nunca',
];

/**
 * Word positions cancelled by a preceding negator. Applied to both lexicons,
 * because negation flips meaning in both directions: "no tuvimos ninguna queja"
 * is not a complaint, and "no recomiendo" is not praise.
 */
function suppressedIndices(words: string[]): Set<number> {
  const suppressed = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    if (!SUPPRESSING_NEGATORS.includes(words[i])) continue;
    for (let k = i + 1; k <= i + windowFor(words[i]) && k < words.length; k++) {
      suppressed.add(k);
    }
  }
  return suppressed;
}

/** Tokenise a normalised clause into words. */
function tokens(normalized: string): string[] {
  return normalized.trim().split(' ').filter(Boolean);
}

/**
 * True when `term` appears un-negated. Multi-word terms are matched on the raw
 * string because they already encode their own polarity ("no recomiendo").
 */
function containsLive(
  normalized: string,
  words: string[],
  suppressed: Set<number>,
  term: string,
): boolean {
  if (term.includes(' ')) return containsPhrase(normalized, term);
  return words.some((word, index) => word === term && !suppressed.has(index));
}

/**
 * Polite improvement requests. A guest who writes "deberian cuidar mas la
 * calidad" is filing a complaint in courteous register; the GM still has work
 * to do, so this is actionable even with no negative adjective present.
 */
const SUGGESTION_PATTERNS = [
  'deberia', 'deberian', 'debieron', 'podrian mejorar', 'podria mejorar',
  'hace falta', 'hacen falta', 'les falta', 'le falta',
  'sugiero', 'sugerencia', 'recomiendo que', 'ojala', 'mejorar',
  'cuidar mas', 'poner atencion', 'prestar atencion', 'revisar',
];

/**
 * Phrases that look like improvement requests but are praise. A guest writing
 * "buena sugerencia por parte de Jesus" is complimenting the waiter's
 * recommendation. These are removed before the suggestion patterns are applied.
 */
const SUGGESTION_EXCLUSIONS = [
  'buena sugerencia', 'buenas sugerencias', 'excelente sugerencia',
  'gran sugerencia', 'buena recomendacion', 'excelente recomendacion',
  'buenas recomendaciones', 'grandes sugerencias',
];

/** Positive markers, used to detect the praise half of a mixed review. */
const POSITIVE_LEXICON = [
  'excelente', 'excelentes', 'delicioso', 'deliciosa', 'deliciosos', 'deliciosas',
  'rico', 'rica', 'riquisimo', 'riquisima', 'buenisimo', 'buenisima',
  'amable', 'amables', 'atento', 'atenta', 'atentos', 'atentas',
  'recomiendo', 'recomendado', 'recomendable', 'encanto', 'encantaron',
  'felicidades', 'gracias', 'perfecto', 'perfecta', 'increible', 'espectacular',
  'maravilloso', 'maravillosa', 'agradable', 'satisfecho', 'satisfecha',
  'volveremos', 'volvere', 'impecable', 'genial', 'crack', 'excepcional',
  'muy bien', 'todo bien', 'todo excelente', 'super bien', 'buena atencion',
  'buen servicio', 'buena experiencia', 'gran experiencia',
  // Base adjectives. Negated uses ("no muy buena") are cancelled by the
  // suppression pass, so these only count when the guest means them.
  'bueno', 'buena', 'buenos', 'buenas', 'buen', 'bien',
];

/**
 * Adversative connectors. Everything after one of these belongs to a different
 * clause than what came before, which is what makes
 * "El servicio excelente, pero la sopa estaba mala" a mixed review rather than
 * a positive one. Split on these and classify each clause on its own.
 */
const ADVERSATIVES = [
  'pero', 'aunque', 'sin embargo', 'solo que', 'lo unico', 'unicamente',
  'solamente', 'salvo que', 'excepto', 'mas sin embargo', 'eso si', 'ahora que',
  'la unica', 'el unico', 'mi unica', 'lo malo',
];

function containsWord(haystack: string, needle: string): boolean {
  return haystack.includes(` ${needle} `);
}

/** Matches multi-word phrases too, since the haystack is space-padded. */
function containsPhrase(haystack: string, needle: string): boolean {
  return needle.includes(' ')
    ? haystack.includes(` ${needle} `) || haystack.includes(` ${needle}`)
    : containsWord(haystack, needle);
}

/** Domains whose negative vocabulary appears in the text, un-negated. */
function negativeDomains(
  normalized: string,
  words: string[],
  suppressed: Set<number>,
): string[] {
  const hits: string[] = [];
  for (const [domain, terms] of Object.entries(NEGATIVE_LEXICON)) {
    if (terms.some((term) => containsLive(normalized, words, suppressed, term))) {
      hits.push(domain);
    }
  }
  return hits;
}

/**
 * True when a negator is followed within NEGATION_WINDOW words by a word that
 * would otherwise read as positive, and the negation is not one of the
 * praising-an-absence exceptions.
 */
function hasNegatedPositive(normalized: string): boolean {
  const words = tokens(normalized);
  for (let i = 0; i < words.length; i++) {
    if (!NEGATORS.includes(words[i])) continue;
    const window = words.slice(i + 1, i + 1 + windowFor(words[i]));
    if (window.length === 0) continue;
    if (window.some((word) => NEGATION_EXCEPTIONS.includes(word))) continue;
    if (window.some((word) => NEGATABLE_POSITIVES.includes(word))) return true;
  }
  return false;
}

function hasSuggestion(normalized: string): boolean {
  let cleaned = normalized;
  for (const exclusion of SUGGESTION_EXCLUSIONS) {
    cleaned = cleaned.split(` ${exclusion} `).join(' ');
  }
  return SUGGESTION_PATTERNS.some((pattern) => containsPhrase(cleaned, pattern));
}

function hasPositive(
  normalized: string,
  words: string[],
  suppressed: Set<number>,
): boolean {
  return POSITIVE_LEXICON.some((term) => containsLive(normalized, words, suppressed, term));
}

/**
 * Sentence terminators. Negation does not carry across them: in
 * "Realmente nada. Buenos alimentos", the "nada" answers a previous question
 * and has nothing to do with the praise that follows.
 */
const SENTENCE_BOUNDARY = /[.!?;\n]+/;

/** Split into clauses on adversative connectors, keeping both sides. */
function splitClauses(normalized: string): string[] {
  let parts = [normalized];
  for (const connector of ADVERSATIVES) {
    const next: string[] = [];
    for (const part of parts) {
      const pieces = part.split(` ${connector} `);
      if (pieces.length === 1) {
        next.push(part);
      } else {
        for (const piece of pieces) next.push(` ${piece.trim()} `);
      }
    }
    parts = next;
  }
  return parts.filter((part) => part.trim().length > 0);
}

/**
 * Text-only analysis. Star rating is applied by the caller, so this stays
 * honest about what the guest actually wrote.
 */
export function analyzeFeedbackText(feedback: string): {
  negative: boolean;
  positive: boolean;
  signals: string[];
} {
  if (normalizeText(feedback).length === 0) {
    return { negative: false, positive: false, signals: [] };
  }

  const signals: string[] = [];
  // Sentences first, then adversative clauses inside each sentence.
  const clauses = feedback
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => normalizeText(sentence))
    .filter((sentence) => sentence.length > 0)
    .flatMap((sentence) => splitClauses(sentence));
  const multiClause = clauses.length > 1;

  const domains = new Set<string>();
  let negated = false;
  let suggestion = false;
  let positive = false;

  for (const clause of clauses) {
    const words = tokens(clause);
    const suppressed = suppressedIndices(words);
    for (const domain of negativeDomains(clause, words, suppressed)) domains.add(domain);
    if (hasNegatedPositive(clause)) negated = true;
    if (hasSuggestion(clause)) suggestion = true;
    if (hasPositive(clause, words, suppressed)) positive = true;
  }

  for (const domain of [...domains].sort()) signals.push(`negative:${domain}`);
  if (negated) signals.push('negative:negated_positive');
  if (suggestion) signals.push('negative:suggestion');
  if (positive) signals.push('positive:praise');
  if (multiClause) signals.push('structure:adversative');

  const negative = domains.size > 0 || negated || suggestion;
  return { negative, positive, signals };
}

/**
 * The single source of truth. Every channel — GM push, GM email, owner and
 * regional escalation, and the inbox — derives its presentation from this.
 *
 * Rating floors are absolute: text can demote a good rating but can never
 * promote a bad one. A guest who leaves 2 stars and writes "todo bien" still
 * gets an urgent classification, because the rating is the stronger signal of
 * dissatisfaction and under-reacting to it is the costlier mistake.
 */
export function classifyReview({ rating, feedback }: ClassifyReviewInput): ReviewClassification {
  const ratingBucket: RatingBucket = rating >= 4 ? 'positive' : 'low';
  const text = (feedback ?? '').trim();

  // Rating floor, independent of anything written.
  let severity: ReviewSeverity = 'praise';
  const signals: string[] = [];

  if (rating <= URGENT_MAX_RATING) {
    severity = 'urgent';
    signals.push(`rating:${rating}_urgent`);
  } else if (rating <= COMPLAINT_MAX_RATING) {
    severity = 'complaint';
    signals.push(`rating:${rating}_complaint`);
  } else {
    signals.push(`rating:${rating}_positive_bucket`);
  }

  if (text.length === 0) {
    return {
      severity,
      actionable: severity !== 'praise',
      ratingBucket,
      signals,
    };
  }

  const { negative, positive, signals: textSignals } = analyzeFeedbackText(text);
  signals.push(...textSignals);

  if (negative) {
    // A complaint plus genuine praise is mixed; a complaint alone is a complaint.
    // Either way it is never presented as good news.
    severity = maxSeverity(severity, positive ? 'mixed' : 'complaint');
  }

  return {
    severity,
    actionable: severity !== 'praise',
    ratingBucket,
    signals,
  };
}

// ── Presentation, derived from severity so recipients cannot disagree ───────

/** Emoji + wording prefix used in push titles and email subjects. */
export const SEVERITY_ICON: Record<ReviewSeverity, string> = {
  praise: '⭐',
  mixed: '⚠️',
  complaint: '⚠️',
  urgent: '🔴',
};

/** Spanish label shown to operators. */
export const SEVERITY_LABEL: Record<ReviewSeverity, string> = {
  praise: 'Positivo',
  mixed: 'Requiere atención',
  complaint: 'Queja',
  urgent: 'Urgente',
};

/** push_notifications.kind. Anything actionable is a low_review for reporting. */
export function pushKindFor(severity: ReviewSeverity): 'positive_review' | 'low_review' {
  return severity === 'praise' ? 'positive_review' : 'low_review';
}

/** Accent colour for the alert email. */
export const SEVERITY_COLOR: Record<ReviewSeverity, string> = {
  praise: '#059669',
  mixed: '#D97706',
  complaint: '#D97706',
  urgent: '#DC2626',
};

export const SEVERITY_COLOR_BG: Record<ReviewSeverity, string> = {
  praise: 'rgba(5,150,105,0.08)',
  mixed: 'rgba(217,119,6,0.08)',
  complaint: 'rgba(217,119,6,0.08)',
  urgent: 'rgba(220,38,38,0.08)',
};

/** Coloured dot for email subject lines. */
export const SEVERITY_DOT: Record<ReviewSeverity, string> = {
  praise: '🟢',
  mixed: '🟡',
  complaint: '🟡',
  urgent: '🔴',
};

/**
 * Guest text cut to fit a push body or an email line.
 *
 * Cuts on code points, not UTF-16 units. String.slice() splits a surrogate
 * pair, so an emoji straddling the cut leaves a lone surrogate behind. JSON
 * carries it through unharmed, web-push then re-encodes the payload as UTF-8
 * and turns it into U+FFFD, and the phone shows "\u{FFFD}" in the middle of the
 * guest's own words. 58 of the 2,137 comments written so far carry an emoji and
 * 244 run past 100 characters, so the cut lands on one rarely, not never.
 *
 * The returned string is never longer than `maxLength` code points, ellipsis
 * included.
 */
export function previewFeedback(text: string, maxLength: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, maxLength - 1).join('').trimEnd()}\u2026`;
}

/**
 * Title for the location's own push. Reads as the GM's view of the review.
 */
export function gmPushTitle(severity: ReviewSeverity, rating: number): string {
  const stars = `${rating} estrella${rating === 1 ? '' : 's'}`;
  if (severity === 'praise') return `${SEVERITY_ICON.praise} Comentario positivo de ${stars}`;
  if (severity === 'mixed') return `${SEVERITY_ICON.mixed} Comentario de ${stars} con un detalle por atender`;
  if (severity === 'complaint') return `${SEVERITY_ICON.complaint} Queja de ${stars}`;
  return `${SEVERITY_ICON.urgent} Queja urgente de ${stars}`;
}

/**
 * Title for owner/regional escalation. Same severity vocabulary as the GM
 * title, prefixed with the location so a multi-location recipient knows where
 * it came from.
 */
export function escalationPushTitle(
  severity: ReviewSeverity,
  rating: number,
  locationName: string,
): string {
  const stars = `${rating} estrella${rating === 1 ? '' : 's'}`;
  if (severity === 'praise') return `${SEVERITY_ICON.praise} ${locationName}: comentario positivo de ${stars}`;
  if (severity === 'mixed') return `${SEVERITY_ICON.mixed} ${locationName}: ${stars} con un detalle por atender`;
  if (severity === 'complaint') return `${SEVERITY_ICON.complaint} ${locationName}: queja de ${stars}`;
  return `${SEVERITY_ICON.urgent} ${locationName}: queja urgente de ${stars}`;
}
