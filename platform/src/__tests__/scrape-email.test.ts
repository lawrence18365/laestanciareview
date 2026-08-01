import { describe, expect, it } from 'vitest';
import { extractEmailFromHtml } from '@/lib/extract-email';

describe('extractEmailFromHtml', () => {
  it('strips a phone fragment glued to an email address', () => {
    expect(extractEmailFromHtml('Tel. 556-4452bajatacosandbeer@gmail.com'))
      .toBe('bajatacosandbeer@gmail.com');
    expect(extractEmailFromHtml('Tel. 5564452bajatacosandbeer@gmail.com'))
      .toBe('bajatacosandbeer@gmail.com');
  });

  it('keeps text from adjacent HTML nodes separated', () => {
    expect(extractEmailFromHtml('<p>477 556 4452</p><p>contacto@restaurante.mx</p>'))
      .toBe('contacto@restaurante.mx');
  });

  it('prefers a decoded mailto link over a later raw address', () => {
    const html = '<a href="mailto:ventas&#64;restaurante&#46;mx">Contacto</a> later@restaurante.mx';

    expect(extractEmailFromHtml(html)).toBe('ventas@restaurante.mx');
  });

  it('rejects image asset and no-reply noise', () => {
    expect(extractEmailFromHtml('<img src="logo@2x.png">')).toBeNull();
    expect(extractEmailFromHtml('noreply@restaurante.mx')).toBeNull();
  });

  it('rejects an all-digits local part', () => {
    expect(extractEmailFromHtml('5564452@restaurante.mx')).toBeNull();
  });
});
