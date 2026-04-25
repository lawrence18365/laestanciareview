import { z } from 'zod';

// Review submission — customer taps NFC card, selects stars
export const submitReviewSchema = z.object({
  restaurantSlug: z.string().min(1).max(100),
  staffCode: z.string().min(1).max(50),
  rating: z.number().int().min(1).max(5),
});

// Feedback form — customer leaves name/email/comments after low rating
export const submitFeedbackSchema = z.object({
  reviewId: z.number().int().positive(),
  customerName: z.string().max(200).optional(),
  customerEmail: z.string().email().max(254).optional(),
  feedback: z.string().min(1).max(5000),
});

// Staff management
export const createStaffSchema = z.object({
  restaurantSlug: z.string().min(1).max(100),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
});

export const updateStaffSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(50).optional(),
  active: z.boolean().optional(),
});

// Restaurant management
export const createRestaurantSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  managerEmail: z.string().email().max(254).optional(),
  googleReviewUrl: z.string().url().max(500).optional(),
  googleThreshold: z.number().int().min(1).max(5).optional(),
  adminPassword: z.string().min(8).max(128).optional(),
});

// Self-serve signup (public /contacto form)
export const signupSchema = z.object({
  businessName: z.string().min(1).max(200),
  contactName: z.string().min(1).max(200),
  email: z.string().email().max(254),
  phone: z.string().min(7).max(32),
  city: z.string().min(1).max(120),
  password: z.string().min(8).max(128),
  googlePlaceId: z.string().min(1).max(300).optional(),
  shippingAddress: z
    .object({
      line1: z.string().min(1).max(300),
      line2: z.string().max(300).optional(),
      city: z.string().min(1).max(120),
      state: z.string().min(1).max(120),
      postalCode: z.string().min(3).max(20),
      notes: z.string().max(500).optional(),
    }),
});
export type SignupInput = z.infer<typeof signupSchema>;

// Settings update
export const updateSettingsSchema = z.object({
  googleReviewUrl: z.string().url().max(500).optional(),
  googleThreshold: z.number().int().min(1).max(5).optional(),
  managerEmail: z.string().email().max(254).optional(),
});

// Guest Capture CRM — public form on /g/[slug]. Dedup key is (whatsapp, brand).
export const guestCaptureSchema = z.object({
  restaurantSlug: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  whatsapp: z
    .string()
    .min(10)
    .max(20)
    .regex(/^[\d+\s\-()]+$/, 'WhatsApp contiene caracteres inválidos'),
  // Mexican guests expect DD/MM; strict to avoid EU/US ambiguity downstream.
  birthdayMmdd: z
    .string()
    .regex(/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])$/, 'Usa el formato DD/MM'),
  preferences: z.array(z.string().min(1).max(50)).max(10).optional(),
  marketingConsent: z.boolean().optional().default(false),
  promoType: z.string().max(50).optional(),
  utmSource: z.string().max(100).optional(),
  utmMedium: z.string().max(100).optional(),
  utmCampaign: z.string().max(100).optional(),
});
export type GuestCaptureInput = z.infer<typeof guestCaptureSchema>;

// Staff-side redemption confirmation.
export const guestValidateSchema = z.object({
  restaurantSlug: z.string().min(1).max(100),
  code: z.string().regex(/^\d{4}$/, 'Código inválido'),
  staffCode: z.string().min(1).max(50),
  redemptionType: z.enum(['copa_vino', 'postre', 'otro']),
  notes: z.string().max(500).optional(),
});

// GM-side mutations on a captured guest.
// Includes core identity fields so a typo can be corrected without recapturing.
export const guestUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  whatsapp: z
    .string()
    .min(10)
    .max(20)
    .regex(/^[\d+\s\-()]+$/, 'WhatsApp contiene caracteres inválidos')
    .optional(),
  birthdayMmdd: z
    .string()
    .regex(/^(0[1-9]|[12]\d|3[01])\/(0[1-9]|1[0-2])$/, 'Usa el formato DD/MM')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  notes: z.string().max(2000).optional(),
  preferences: z.array(z.string().min(1).max(50)).max(10).optional(),
  marketingConsent: z.boolean().optional(),
});

export const guestManualVisitSchema = z.object({
  notes: z.string().max(500).optional(),
  staffCode: z.string().min(1).max(50).optional(),
});

// /api/auth/staff — session-protected staff CRUD body schemas.
export const sessionStaffCreateSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().min(1).max(50),
});

export const sessionStaffUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(200).optional(),
  code: z.string().min(1).max(50).optional(),
  active: z.boolean().optional(),
});

export const sessionStaffDeleteSchema = z.object({
  id: z.number().int().positive(),
});

// /api/auth/feedback — PATCH body for changing review status.
export const sessionFeedbackPatchSchema = z.object({
  reviewId: z.number().int().positive(),
  status: z.enum(['new', 'reviewed', 'resolved']),
});

// Quote builder — POST/PUT body schema. Numeric strings are bounded so a
// negative or absurd input cannot produce a malformed quote.
const moneyString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), 'Must be a number')
  .refine((v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 && n <= 10_000_000;
  }, 'Out of range');

const percentString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), 'Must be a number')
  .refine((v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 && n <= 100;
  }, 'Must be between 0 and 100');

const quoteItemsMap = z
  .record(z.string().min(1).max(50), z.array(z.string().min(1).max(300)).max(50))
  .optional();

export const quoteCreateSchema = z.object({
  clientName: z.string().min(1).max(200),
  clientPhone: z.string().max(50).optional().nullable(),
  clientEmail: z.string().email().max(254).optional().nullable(),
  clientCompany: z.string().max(200).optional().nullable(),
  eventDate: z.string().max(40).optional().nullable(),
  eventType: z.string().max(80).optional().nullable(),
  guestCount: z.coerce.number().int().min(1).max(10000).default(1),
  eventNotes: z.string().max(5000).optional().nullable(),
  pricePerPerson: moneyString.optional().default('0'),
  serviceChargePercent: percentString.optional().default('10'),
  ivaPercent: percentString.optional().default('16'),
  packageName: z.string().max(200).optional().nullable(),
  terms: z.string().max(20000).optional().nullable(),
  configJson: z.unknown().optional(),
  items: quoteItemsMap,
});

export const quoteUpdateSchema = quoteCreateSchema.extend({
  status: z.enum(['draft', 'sent', 'accepted', 'expired']).optional(),
});
