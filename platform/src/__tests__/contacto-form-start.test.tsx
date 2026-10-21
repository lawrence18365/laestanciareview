/**
 * SQ-219: /contacto form-start rate. The form (Google business search first)
 * sits above the fold on a phone, the proof block moves below it, the place
 * pick fills name and city, and the first field is instrumented.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/script', () => ({ default: () => null }));
vi.mock('@/lib/analytics-client', () => ({ track: vi.fn(), getSessionId: () => null }));
// product-events imports the db client, which reads DATABASE_URL at load.
vi.mock('@/db', () => ({ db: {} }));

import ContactoForm, {
  FIRST_FIELD_ID,
  applyPlaceSelection,
  trackFirstFieldFocus,
  type Form,
} from '@/app/contacto/ContactoForm';
import { PLACE_SEARCH_HELPER } from '@/components/GooglePlaceSearch';
import { PRODUCT_EVENT_NAMES, PUBLIC_EVENT_NAMES } from '@/lib/product-events';

const html = renderToStaticMarkup(<ContactoForm pilotOffer={false} />);

// Visible words on the non-pilot page before SQ-219 (measured on the same
// render: static markup, tags and style blocks removed). The page may shrink,
// never grow.
const WORDS_BEFORE = 126;

function visibleWords(markup: string) {
  return markup
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

describe('/contacto above the fold', () => {
  it('leads with the ad promise and a one-line subhead, within 30 words', () => {
    const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/)![1];
    const sub = html.match(/<\/h1><p[^>]*>(.*?)<\/p>/)![1];
    expect(h1).toBe('Más reseñas en Google, todos los días.');
    expect(sub).toBe('30 días gratis. Sin tarjeta. Listo en 2 minutos.');
    expect(visibleWords(`${h1} ${sub}`).length).toBeLessThanOrEqual(30);
  });

  it('puts the Google business search first in the form', () => {
    const formHtml = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    expect(formHtml.indexOf('Busca tu negocio en Google')).toBeGreaterThan(-1);
    const firstInput = formHtml.match(/<input[^>]*>/)![0];
    expect(firstInput).toContain(`id="${FIRST_FIELD_ID}"`);
    expect(FIRST_FIELD_ID).toBe('businessName');
    expect(html).toContain(PLACE_SEARCH_HELPER);
  });

  it('renders the form above the proof block and keeps the proof block', () => {
    const formAt = html.indexOf('<form');
    const formEnd = html.indexOf('</form>');
    // The <img> itself (React may also emit a <link rel="preload"> up front).
    const proofAt = html.indexOf('src="/contacto/guest-choice-mobile.webp"');
    expect(formAt).toBeGreaterThan(-1);
    expect(proofAt).toBeGreaterThan(formEnd);
    expect(html.indexOf('Tu cliente escanea tu QR')).toBeGreaterThan(formEnd);
    expect(html).toContain('11 restaurantes reales');
  });
});

describe('/contacto form fields', () => {
  it('shows place search, the two tap questions, name, WhatsApp, email, password, in that order', () => {
    const marks = [
      `id="${FIRST_FIELD_ID}"`,
      'name="locationsBand"',
      'name="teamMode"',
      'autoComplete="name"',
      'type="tel"',
      'type="email"',
      'type="password"',
    ];
    const positions = marks.map((m) => html.indexOf(m));
    positions.forEach((p, i) => expect(p, `${marks[i]} missing`).toBeGreaterThan(-1));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('does not ask for the city up front: the place pick fills it', () => {
    expect(html).not.toContain('placeholder="Ciudad"');
    expect(html).not.toContain('Tu negocio');
    expect(html).not.toContain('Tu contacto');
  });

  it('keeps native validation on every field', () => {
    const formHtml = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
    const inputs = formHtml.match(/<input[^>]*>/g)!;
    // search + 5 radios + name + phone + email + password
    expect(inputs).toHaveLength(10);
    for (const input of inputs) expect(input).toMatch(/required/);
    expect(formHtml).toMatch(/type="password"[^>]*minLength="8"|minLength="8"[^>]*type="password"/);
  });

  it('has one CTA: "Crear mi cuenta gratis"', () => {
    expect(html.match(/<button[^>]*type="submit"[^>]*>(.*?)<\/button>/g)).toHaveLength(1);
    expect(html).toContain('>Crear mi cuenta gratis</button>');
    expect(html).not.toContain('Activar ahora');
  });
});

describe('/contacto word budget', () => {
  it('shows no more visible words than before', () => {
    expect(visibleWords(html).length).toBeLessThanOrEqual(WORDS_BEFORE);
  });
});

describe('place pick', () => {
  const empty: Form = {
    businessName: '',
    googlePlaceId: '',
    contactName: '',
    email: '',
    phone: '',
    city: '',
    locationsBand: '',
    teamMode: '',
    password: '',
    line1: '',
    line2: '',
    addrCity: '',
    state: '',
    postalCode: '',
    notes: '',
  };

  it('prefills the business name and the city from Google', () => {
    const next = applyPlaceSelection(empty, {
      placeId: 'ChIJ123',
      name: 'La Estancia',
      address: { city: 'León', state: 'Guanajuato' },
      fullAddress: 'Blvd. Campestre 1, León, Gto.',
    });
    expect(next.businessName).toBe('La Estancia');
    expect(next.city).toBe('León');
    expect(next.googlePlaceId).toBe('ChIJ123');
    expect(next.state).toBe('Guanajuato');
  });

  it('keeps what the form already has when Google returns no city', () => {
    const next = applyPlaceSelection(
      { ...empty, city: 'Puebla', contactName: 'Ana' },
      { placeId: 'ChIJ9', name: 'Tacos', address: { city: '', state: '' }, fullAddress: '' },
    );
    expect(next.city).toBe('Puebla');
    expect(next.contactName).toBe('Ana');
    expect(next.businessName).toBe('Tacos');
  });
});

describe('signup_field_focused', () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
    };
  }

  it('is an allowed, public event so the anonymous visitor is counted', () => {
    expect(PRODUCT_EVENT_NAMES).toContain('signup_field_focused');
    expect(PUBLIC_EVENT_NAMES).toContain('signup_field_focused');
  });

  it('fires for the first field only, once per session', () => {
    const storage = fakeStorage();
    const emit = vi.fn();
    expect(trackFirstFieldFocus('email', storage, emit)).toBe(false);
    expect(trackFirstFieldFocus(FIRST_FIELD_ID, storage, emit)).toBe(true);
    expect(trackFirstFieldFocus(FIRST_FIELD_ID, storage, emit)).toBe(false);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('does not fire again in a session that already counted', () => {
    const emit = vi.fn();
    const storage = fakeStorage({ rt_signup_field_focused: '1' });
    expect(trackFirstFieldFocus(FIRST_FIELD_ID, storage, emit)).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('still fires once when storage is blocked', () => {
    const emit = vi.fn();
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(trackFirstFieldFocus(FIRST_FIELD_ID, blocked, emit)).toBe(true);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
