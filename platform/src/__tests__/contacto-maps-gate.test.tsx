/**
 * /contacto: a submit without a Google pick stops once on "Necesitas estar en
 * Google Maps" (create a profile, or continue if the search missed a real
 * listing). A Google pick never sees it.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next/script', () => ({ default: () => null }));
vi.mock('@/lib/analytics-client', () => ({ track: vi.fn(), getSessionId: () => null }));
vi.mock('@/db', () => ({ db: {} }));

import { GOOGLE_PROFILE_CREATE_URL, needsMapsGate } from '@/app/contacto/ContactoForm';
import { PRODUCT_EVENT_NAMES, PUBLIC_EVENT_NAMES } from '@/lib/product-events';

const source = readFileSync(join(__dirname, '..', 'app', 'contacto', 'ContactoForm.tsx'), 'utf8');

describe('Google Maps gate', () => {
  it('stops a submit with no Place ID until the owner chooses to continue', () => {
    expect(needsMapsGate({ googlePlaceId: '' }, false)).toBe(true);
    expect(needsMapsGate({ googlePlaceId: '' }, true)).toBe(false);
  });

  it('never stops a submit that picked a place from Google', () => {
    expect(needsMapsGate({ googlePlaceId: 'ChIJabc' }, false)).toBe(false);
  });

  it('checks the gate before anything is sent or tracked as a submit', () => {
    const body = source.slice(source.indexOf('async function handleSubmit'));
    const gate = body.indexOf('needsMapsGate(form, confirmedOnMapsRef.current)');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(body.indexOf("track('signup_submit'"));
    expect(gate).toBeLessThan(body.indexOf("fetch('/api/signup/create-checkout'"));
  });

  it('offers Google profile creation and a continue path, in few words', () => {
    expect(GOOGLE_PROFILE_CREATE_URL).toBe('https://business.google.com/create');
    const copy = ['Necesitas estar en Google Maps.', 'Elígelo de la lista de arriba.', 'Crear mi perfil gratis', 'Ya estoy en Google, continuar'];
    for (const c of copy) expect(source).toContain(c);
    expect(copy.join(' ').split(/\s+/).length).toBeLessThanOrEqual(20);
  });

  it('records the gate as a public funnel event', () => {
    expect(PRODUCT_EVENT_NAMES).toContain('signup_maps_gate');
    expect(PUBLIC_EVENT_NAMES).toContain('signup_maps_gate');
  });
});
