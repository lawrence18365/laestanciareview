import { describe, it, expect } from 'vitest';
import {
  buildProspectWhatsappMessage,
  buildProspectWhatsappUrl,
  waPhone,
} from '@/lib/prospect-whatsapp';

describe('buildProspectWhatsappMessage', () => {
  it('includes rating and review count when both are present', () => {
    const msg = buildProspectWhatsappMessage({
      restaurantName: 'Taquería El Buen Sabor',
      rating: '4.3',
      reviewCount: 1234,
      city: 'León',
    });
    expect(msg).toBe(
      'Hola, buen día. Le escribo de parte de RateTap, el sistema con el que La Estancia mide a sus meseros en 12 restaurantes.' +
        ' Vi que Taquería El Buen Sabor tiene 4.3★ con 1,234 reseñas en Google.' +
        ' Le hago una pregunta que casi ningún dueño puede contestar: ¿sabe cuál de sus meseros atiende mejor y cuál está a punto de renunciar? Nosotros lo vemos mesero por mesero y por turno. ¿Le enseño cómo en 10 minutos? Sin compromiso.',
    );
  });

  it('falls back to the plain hook when rating is missing', () => {
    const msg = buildProspectWhatsappMessage({
      restaurantName: 'El Fondón',
      rating: null,
      reviewCount: null,
      city: null,
    });
    expect(msg).toBe(
      'Hola, buen día. Le escribo de parte de RateTap, el sistema con el que La Estancia mide a sus meseros en 12 restaurantes.' +
        ' Vi El Fondón en Google.' +
        ' Le hago una pregunta que casi ningún dueño puede contestar: ¿sabe cuál de sus meseros atiende mejor y cuál está a punto de renunciar? Nosotros lo vemos mesero por mesero y por turno. ¿Le enseño cómo en 10 minutos? Sin compromiso.',
    );
  });

  it('falls back when reviewCount is missing even if rating exists', () => {
    const msg = buildProspectWhatsappMessage({
      restaurantName: 'El Fondón',
      rating: '4.8',
      reviewCount: null,
      city: null,
    });
    expect(msg).toContain(' Vi El Fondón en Google.');
    expect(msg).not.toContain('4.8★');
  });

  it('never contains em dashes, audit links, or the old pitch', () => {
    const msg = buildProspectWhatsappMessage({
      restaurantName: 'La Estancia',
      rating: '4.5',
      reviewCount: 890,
      city: 'León',
    });
    expect(msg).not.toContain('—');
    expect(msg).not.toContain('/audit/');
    expect(msg).not.toContain('subir su calificación');
  });
});

describe('waPhone', () => {
  it('adds the 52 prefix to 10-digit Mexican numbers', () => {
    expect(waPhone('55 1234 5678')).toBe('525512345678');
    expect(waPhone('(477) 123-4567')).toBe('524771234567');
  });

  it('strips formatting but leaves already-international numbers alone', () => {
    expect(waPhone('+52 55 1234 5678')).toBe('525512345678');
    expect(waPhone('+1 (415) 555-0132')).toBe('14155550132');
  });
});

describe('buildProspectWhatsappUrl', () => {
  it('builds a wa.me URL with the normalised phone and encoded message', () => {
    const url = buildProspectWhatsappUrl(
      { restaurantName: 'El Fondón', rating: '4.2', reviewCount: 57, city: 'León' },
      '477 123 4567',
    );
    expect(url.startsWith('https://wa.me/524771234567?text=')).toBe(true);
    const text = decodeURIComponent(url.split('?text=')[1]);
    expect(text).toBe(
      buildProspectWhatsappMessage({
        restaurantName: 'El Fondón',
        rating: '4.2',
        reviewCount: 57,
        city: 'León',
      }),
    );
  });
});
