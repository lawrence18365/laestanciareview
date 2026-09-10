/**
 * Guest-facing WhatsApp copy and birthday-window logic, in one place.
 *
 * The birthday offer used to be written twice — once on /vip-vino and once on
 * /guests — and the two had drifted apart. They are the same offer, so they
 * share one template now.
 *
 * Offer of record (CEO, 2026-09-10): a courtesy bottle of Vino Verdades for
 * Club VIP members, redeemed by replying on WhatsApp to book a table.
 */

/** First token, Title-cased. Names are stored in caps ("QUINTIN Morgado"). */
export function guestFirstName(value: string): string {
  const first = value.trim().split(/\s+/)[0] || '';
  if (!first) return value.trim();
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/**
 * Birthday invitation for the "Cumple este mes" filter.
 *
 * `restaurantName` should come from getGuestFacingName(), not from
 * restaurants.name — a guest should read "La Estancia Argentina León", not the
 * operational label "Estancia Leon".
 *
 * The emoji are intentional and must survive transport. Callers build the
 * wa.me link with encodeURIComponent(), which percent-encodes the UTF-8 bytes
 * correctly; never hand this string to escape() or a latin-1 encoder.
 */
export function birthdayMessage(name: string, restaurantName: string): string {
  return `¡Hola ${guestFirstName(name)}! Vimos que este mes es tu cumpleaños 🎉

Como socio del Club VIP tienes una botella de Vino Verdades de cortesía para celebrarlo con nosotros.

¿Qué día lo festejas? Te aparto mesa desde ahorita.`;
}

// ────────────────────────────────────────────────────────────
// Birthday window
// ────────────────────────────────────────────────────────────

/**
 * How many days ahead the birthday filter looks.
 *
 * Deliberately not "this calendar month": messaging someone on the 1st about a
 * birthday on the 28th is wasted outreach, and it burns the one WhatsApp touch
 * we get. A short forward window means the message lands close enough to the
 * date that booking a table is a live decision.
 */
export const BIRTHDAY_WINDOW_DAYS = 10;

/**
 * "DD/MM" for a date, matching how guests.birthday_mmdd is stored and what
 * todayBirthdayKeyMexico() returns. Day first — the whole dataset is DD/MM and
 * an MM/DD key here would silently match the wrong guests for every date up to
 * the 12th of a month.
 */
export function toBirthdayKey(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/**
 * The ordered set of "DD/MM" keys covered by the window starting at `from`.
 *
 * Ordered so callers can both test membership and sort guests by how soon the
 * birthday lands. Wraps across year end. Feb 29 is only produced in a leap
 * year; a Feb-29 guest in a common year is reached by the Mar-1 key, which is
 * better than never messaging them at all.
 */
export function birthdayWindowKeys(
  from: Date,
  days: number = BIRTHDAY_WINDOW_DAYS,
): string[] {
  const keys: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < days; i++) {
    keys.push(toBirthdayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

/**
 * Days until `birthdayMmdd` from `from`, ignoring year. Returns null when the
 * guest has no birthday recorded. Used to sort the filter soonest-first.
 */
export function daysUntilBirthday(
  birthdayMmdd: string | null | undefined,
  from: Date,
): number | null {
  if (!birthdayMmdd) return null;
  const window = birthdayWindowKeys(from, 366);
  const index = window.indexOf(birthdayMmdd);
  return index === -1 ? null : index;
}
