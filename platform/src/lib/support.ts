/**
 * Support contact constants.
 *
 * Change SUPPORT_WHATSAPP_NUMBER when the business number changes — it
 * propagates everywhere automatically (SubscriptionBlocked, bienvenida, etc.)
 *
 * Format: E.164 digits only, no + prefix, no spaces.
 * Example: 5215512345678 = Mexico (+52) 55 1234 5678
 */

const SUPPORT_WHATSAPP_NUMBER =
  (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? '5215512345678').trim();

/** Base wa.me URL for the support number, no message pre-fill. */
export const SUPPORT_WHATSAPP_URL = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}`;

/** wa.me URL with a pre-filled message for payment-update requests. */
export const SUPPORT_WHATSAPP_PAYMENT_URL =
  `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=Hola%2C+necesito+actualizar+mi+tarjeta+de+pago+en+RateTap`;

/** wa.me URL with a pre-filled message for account reactivation. */
export const SUPPORT_WHATSAPP_REACTIVATION_URL =
  `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=Hola%2C+quiero+reactivar+mi+cuenta+de+RateTap`;
