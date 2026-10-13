import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The non-pilot /contacto page carries the proof block above the form. These
// assertions pin the copy that cold Meta traffic reads, so a copy change has to
// be deliberate rather than a silent edit. See SPEC-contacto-proof.md.
const source = readFileSync(
  path.resolve(__dirname, '../app/contacto/ContactoForm.tsx'),
  'utf8',
);

describe('contacto proof copy', () => {
  it('shows the proof card and its price fine print', () => {
    expect(source).toContain('11 restaurantes reales');
    expect(source).toContain('MX$700/mes por sucursal');
    expect(source).toContain('/contacto/guest-choice-mobile.webp');
    expect(source).toContain('Escanea el QR del mesero');
  });

  it('no longer claims 12 restaurants', () => {
    expect(source).not.toContain('Lo usan 12 restaurantes');
  });
});
