/**
 * Regression tests for review classification.
 *
 * The anchor case is Harbor's Angelopolis review #28768 (16 sep 2026): a 4-star
 * review containing a clear food-quality complaint that was announced to the GM
 * as "⭐ Comentario positivo de 4 estrellas" while the owner and regional
 * manager were told it was a problem.
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeFeedbackText,
  classifyReview,
  escalationPushTitle,
  gmPushTitle,
  normalizeText,
  pushKindFor,
  type ReviewSeverity,
} from '@/lib/review-classification';

/** The exact text of review #28768, accents and all. */
const REVIEW_28768 =
  'Pedimos la sopa de mariscos y estaba realmente mala, no tenía sabor, creo que si debería cuidar más la calidad de los alimentos \nEl servicio excelente! ';

describe('normalizeText', () => {
  it('folds accents so phone-keyboard spelling matches', () => {
    expect(normalizeText('no tenía sabor')).toBe(' no tenia sabor ');
  });

  it('collapses punctuation and whitespace', () => {
    expect(normalizeText('Mala!!  ¿Por qué?\n\nFría.')).toBe(' mala por que fria ');
  });

  it('returns an empty string for text with no words', () => {
    expect(normalizeText('   !!!  ')).toBe('');
  });
});

describe('classifyReview — the #28768 regression', () => {
  const result = classifyReview({ rating: 4, feedback: REVIEW_28768 });

  it('is not praise', () => {
    expect(result.severity).not.toBe('praise');
  });

  it('is mixed: a real complaint alongside real praise for the service', () => {
    expect(result.severity).toBe('mixed');
  });

  it('is actionable', () => {
    expect(result.actionable).toBe(true);
  });

  it('never reaches the GM as a positive_review push', () => {
    expect(pushKindFor(result.severity)).toBe('low_review');
  });

  it('does not tell the GM the comment was positive', () => {
    expect(gmPushTitle(result.severity, 4)).not.toContain('positivo');
  });

  it('keeps the 4-star rating bucket intact', () => {
    expect(result.ratingBucket).toBe('positive');
  });

  it('explains itself: food quality, the negation, and the polite request', () => {
    expect(result.signals).toContain('negative:food_quality');
    expect(result.signals).toContain('negative:negated_positive');
    expect(result.signals).toContain('negative:suggestion');
    expect(result.signals).toContain('positive:praise');
  });
});

describe('classifyReview — 4 stars with a clear complaint', () => {
  it.each([
    ['la comida estaba fría', 'temperature'],
    ['el mesero fue grosero', 'service'],
    ['el baño estaba sucio', 'cleanliness'],
    ['tardaron muchísimo en traer la orden', 'wait'],
    ['todo carísimo para lo que dan', 'price'],
  ])('treats %j as a complaint, not praise', (feedback) => {
    const result = classifyReview({ rating: 4, feedback });
    expect(result.severity).toBe('complaint');
    expect(result.actionable).toBe(true);
    expect(pushKindFor(result.severity)).toBe('low_review');
  });

  it('catches a complaint that carries no negative adjective at all', () => {
    // The complaint lives entirely in the negation.
    const result = classifyReview({ rating: 4, feedback: 'La sopa no tenía sabor' });
    expect(result.severity).toBe('complaint');
    expect(result.signals).toContain('negative:negated_positive');
  });

  it('catches a complaint filed in polite register', () => {
    const result = classifyReview({
      rating: 4,
      feedback: 'Deberían cuidar más la calidad de los alimentos',
    });
    expect(result.actionable).toBe(true);
    expect(result.signals).toContain('negative:suggestion');
  });
});

describe('classifyReview — 4 stars, mixed positive and complaint', () => {
  it.each([
    'El servicio fue excelente, pero la sopa de mariscos estaba horrible',
    'Todo muy rico, aunque el postre estaba seco',
    'Muy buena atención, lo único que la carne estaba fría',
    'Excelente lugar, sin embargo tardaron mucho en atendernos',
  ])('classifies %j as mixed', (feedback) => {
    const result = classifyReview({ rating: 4, feedback });
    expect(result.severity).toBe('mixed');
    expect(result.actionable).toBe(true);
    expect(pushKindFor(result.severity)).toBe('low_review');
  });

  it('marks the adversative structure in the signals', () => {
    const result = classifyReview({
      rating: 4,
      feedback: 'El servicio excelente, pero la sopa estaba mala',
    });
    expect(result.signals).toContain('structure:adversative');
    expect(result.signals).toContain('positive:praise');
  });
});

describe('classifyReview — 4 stars, genuinely positive', () => {
  it.each([
    'Todo bien, comida bien, servicio bien',
    'Excelente servicio y calidad de alimentos, muy buena atención',
    'Muy rico todo, volveremos',
    'Gracias por la excelente atención',
    'Todo excelente, sin duda volveremos',
    'Sin problema alguno, muy recomendable',
  ])('keeps %j as praise', (feedback) => {
    const result = classifyReview({ rating: 4, feedback });
    expect(result.severity).toBe('praise');
    expect(result.actionable).toBe(false);
    expect(pushKindFor(result.severity)).toBe('positive_review');
    expect(gmPushTitle(result.severity, 4)).toContain('positivo');
  });

  it('keeps an empty comment at 4 stars as praise', () => {
    const result = classifyReview({ rating: 4, feedback: '' });
    expect(result.severity).toBe('praise');
    expect(result.actionable).toBe(false);
  });

  it('keeps a null comment at 5 stars as praise', () => {
    const result = classifyReview({ rating: 5, feedback: null });
    expect(result.severity).toBe('praise');
  });
});

describe('classifyReview — 5 stars with a complaint', () => {
  it('demotes a 5-star review whose text reports a real problem', () => {
    // Harbor's Angelopolis #27967, four days before #28768: same dish, 5 stars,
    // and the GM was told nothing at all.
    const result = classifyReview({
      rating: 5,
      feedback: 'Todo excelente, únicamente en alguna ocasión me tocó la sopa de mariscos sin sabor y deshabrido, tal vez mala suerte',
    });
    expect(result.severity).toBe('mixed');
    expect(result.actionable).toBe(true);
    expect(pushKindFor(result.severity)).toBe('low_review');
  });

  it('flags a blunt 5-star complaint', () => {
    const result = classifyReview({
      rating: 5,
      feedback: 'La ensalada César no saben prepararla',
    });
    expect(result.actionable).toBe(true);
    expect(result.severity).not.toBe('praise');
  });
});

describe('classifyReview — low-star negative reviews', () => {
  it.each<[number, ReviewSeverity]>([
    [1, 'urgent'],
    [2, 'urgent'],
    [3, 'complaint'],
  ])('classifies %i stars as %s', (rating, expected) => {
    const result = classifyReview({ rating, feedback: 'Todo estuvo pésimo' });
    expect(result.severity).toBe(expected);
    expect(result.actionable).toBe(true);
    expect(result.ratingBucket).toBe('low');
  });

  it('never lets kind text promote a low rating', () => {
    // Under-reacting to a 2-star is the costlier mistake, so the floor holds.
    const result = classifyReview({ rating: 2, feedback: 'Todo bien, muy amables' });
    expect(result.severity).toBe('urgent');
    expect(result.actionable).toBe(true);
  });

  it('keeps a 1-star with no comment urgent', () => {
    expect(classifyReview({ rating: 1, feedback: null }).severity).toBe('urgent');
  });
});

describe('GM and escalation messaging can never contradict each other', () => {
  const cases: { label: string; rating: number; feedback: string | null }[] = [
    { label: '#28768 as filed', rating: 4, feedback: REVIEW_28768 },
    { label: '4-star clear complaint', rating: 4, feedback: 'La comida estaba fría' },
    { label: '4-star genuinely positive', rating: 4, feedback: 'Todo bien, muy amables' },
    { label: '5-star complaint', rating: 5, feedback: 'La sopa no tenía sabor' },
    { label: '5-star pure praise', rating: 5, feedback: 'Excelente todo, gracias' },
    { label: '3-star', rating: 3, feedback: 'Estuvo regular' },
    { label: '1-star', rating: 1, feedback: 'Pésimo servicio' },
    { label: 'empty comment', rating: 4, feedback: '' },
    { label: 'null comment', rating: 5, feedback: null },
  ];

  it.each(cases)('$label: both sides derive from one severity', ({ rating, feedback }) => {
    const { severity } = classifyReview({ rating, feedback });

    const gm = gmPushTitle(severity, rating);
    const escalation = escalationPushTitle(severity, rating, "Harbor's Angelopolis");

    // The decisive property: if one side calls it positive, so must the other.
    const gmSaysPositive = gm.includes('positivo');
    const escalationSaysPositive = escalation.includes('positivo');
    expect(gmSaysPositive).toBe(escalationSaysPositive);

    // And the warning icon is shared too.
    expect(gm.startsWith('⭐')).toBe(escalation.startsWith('⭐'));
  });

  it.each(cases)('$label: one push kind for every recipient', ({ rating, feedback }) => {
    const { severity } = classifyReview({ rating, feedback });
    // pushKindFor is a pure function of severity, so GM and escalation cannot
    // diverge unless someone reintroduces a second source of truth.
    expect(pushKindFor(severity)).toBe(pushKindFor(severity));
    expect(['positive_review', 'low_review']).toContain(pushKindFor(severity));
  });

  it('an actionable review is never announced as positive to anyone', () => {
    for (const { rating, feedback } of cases) {
      const result = classifyReview({ rating, feedback });
      if (!result.actionable) continue;
      expect(gmPushTitle(result.severity, rating)).not.toContain('positivo');
      expect(escalationPushTitle(result.severity, rating, 'X')).not.toContain('positivo');
      expect(pushKindFor(result.severity)).toBe('low_review');
    }
  });
});

/**
 * False positives found by replaying all 2,117 historical reviews that carry
 * text through the classifier. Each of these was demoted out of "praise" by an
 * earlier revision and is genuinely positive.
 */
describe('false positives found in the historical backtest', () => {
  it.each([
    // "nada" is the answer to "anything we could improve?" — not a complaint.
    ['nada, todo bien', 5],
    ['Nada, todo muy bien, atención muy buena', 5],
    ['Realmente nada. Buenos alimentos y buena atención', 5],
    // The waiter made a good recommendation; nobody is asking for a change.
    ['Muy rico el cabrito, buena sugerencia por parte de Jesús', 5],
  ])('keeps %j as praise', (feedback, rating) => {
    const result = classifyReview({ rating, feedback });
    expect(result.severity).toBe('praise');
    expect(result.actionable).toBe(false);
  });

  it('still catches the genuine negative use of "nada"', () => {
    expect(classifyReview({ rating: 5, feedback: 'La comida nada buena' }).actionable).toBe(true);
  });

  it('still catches real complaints found in the same backtest', () => {
    // Waiter delay, softened by an adversative.
    expect(
      classifyReview({ rating: 5, feedback: 'Solo se tardaron en tomarnos la orden pero de ahí todo bien' }).actionable,
    ).toBe(true);
    // A bare improvement request with no negative adjective at all.
    expect(
      classifyReview({ rating: 4, feedback: 'Mejorar área de niños' }).actionable,
    ).toBe(true);
  });

  it('does not let a negation cross a sentence boundary', () => {
    // "nada" ends its own sentence; the praise after it is unrelated.
    const result = analyzeFeedbackText('Realmente nada. Buenos alimentos');
    expect(result.negative).toBe(false);
    expect(result.positive).toBe(true);
  });
});

describe('analyzeFeedbackText', () => {
  it('reports no signals for empty text', () => {
    expect(analyzeFeedbackText('')).toEqual({ negative: false, positive: false, signals: [] });
  });

  it('does not read "sin duda" or "no hay queja" as complaints', () => {
    expect(analyzeFeedbackText('Sin duda volveremos').negative).toBe(false);
    expect(analyzeFeedbackText('No tuvimos ninguna queja').negative).toBe(false);
  });

  it('detects both halves of a mixed comment', () => {
    const result = analyzeFeedbackText('El servicio excelente pero la sopa estaba mala');
    expect(result.negative).toBe(true);
    expect(result.positive).toBe(true);
  });
});
