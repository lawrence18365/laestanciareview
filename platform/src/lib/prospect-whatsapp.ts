/**
 * Shared WhatsApp message builder for prospect outreach (/prospects board
 * and the founder daily hit-list email). One copy, one place: es-MX, usted,
 * no em dashes, no audit link.
 */

export interface ProspectWhatsappInput {
  restaurantName: string;
  rating: string | null;
  reviewCount: number | null;
  city: string | null;
  tier?: string | null;
  locations?: number | null;
}

/**
 * Normalise a phone for wa.me: digits only; 10-digit Mexican numbers get
 * the 52 country prefix so wa.me resolves them.
 */
export function waPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `52${digits}` : digits;
}

export function buildProspectWhatsappMessage(p: ProspectWhatsappInput): string {
  if (p.tier === 'group') {
    const hook = p.locations
      ? ` Vi que ${p.restaurantName} opera ${p.locations} sucursales.`
      : ` Vi que ${p.restaurantName} opera varias sucursales.`;
    return (
      'Hola, buen día. Le escribo de parte de RateTap, el sistema con el que La Estancia mide a sus meseros en 12 restaurantes.' +
      hook +
      ' Le hago una pregunta que casi ningún dueño puede contestar: ¿cuál de sus sucursales está pidiendo reseñas y cuál no, y cuál de sus meseros dejó de pedir esta semana? Nosotros lo vemos mesero por mesero, turno por turno y sucursal por sucursal. ¿Le enseño cómo en 15 minutos? Sin compromiso.'
    );
  }
  const hook =
    p.rating && p.reviewCount !== null
      ? ` Vi que ${p.restaurantName} tiene ${p.rating}★ con ${p.reviewCount.toLocaleString('es-MX')} reseñas en Google.`
      : ` Vi ${p.restaurantName} en Google.`;
  return (
    'Hola, buen día. Le escribo de parte de RateTap, el sistema con el que La Estancia mide a sus meseros en 12 restaurantes.' +
    hook +
    ' Le hago una pregunta que casi ningún dueño puede contestar: ¿sabe cuál de sus meseros atiende mejor y cuál dejó de pedir opiniones esta semana? Nosotros lo vemos mesero por mesero y por turno. ¿Le enseño cómo en 10 minutos? Sin compromiso.'
  );
}

export function buildProspectWhatsappUrl(p: ProspectWhatsappInput, phone: string): string {
  return `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(buildProspectWhatsappMessage(p))}`;
}
