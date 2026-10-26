import { z } from 'zod';
import { RESOLUTIONS, REVIEWED_VIA } from '@/lib/review-recovery';
import { QUOTE_STATUSES } from '@/lib/quote-status';

// Review submission — customer taps NFC card, selects stars
export const submitReviewSchema = z.object({
  restaurantSlug: z.string().min(1).max(100),
  // Empty or missing = a /r/<slug> scan without ?card=CODE: no server, not invalid.
  staffCode: z.string().max(50).optional(),
  rating: z.number().int().min(1).max(5),
});

// Feedback form — customer leaves name/email/comments after low rating
export const submitFeedbackSchema = z.object({
  reviewId: z.number().int().positive(),
  feedbackToken: z.string().min(32).max(256),
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
  groupKey: z.string().trim().min(1).max(100).optional(),
});

// Self-serve signup (public /contacto form)
export const signupSchema = z.object({
  // No "@": login resolves a typed email before any name, so a business name
  // containing "@" could otherwise be mistaken for (or shadow) an email.
  businessName: z
    .string()
    .min(1)
    .max(200)
    .refine((name) => !name.includes('@'), { message: 'El nombre no puede incluir @' }),
  contactName: z.string().min(1).max(200),
  email: z.string().email().max(254),
  phone: z.string().min(7).max(32),
  city: z.string().min(1).max(120),
  password: z.string().min(8).max(128),
  googlePlaceId: z.string().min(1).max(300).optional(),
  source: z.string().trim().max(120).optional(),
  landingPath: z.string().trim().max(600).optional(),
  utmSource: z.string().trim().max(160).optional(),
  utmMedium: z.string().trim().max(160).optional(),
  utmCampaign: z.string().trim().max(200).optional(),
  utmTerm: z.string().trim().max(200).optional(),
  utmContent: z.string().trim().max(200).optional(),
  offer: z.string().trim().max(120).optional(),
  // Per-tab analytics session id from the /contacto client, written as
  // `signup_completed.session_id` so the anonymous funnel steps can be stitched
  // to the account. Not an identifier for anyone: it is a random per-tab value.
  analyticsSessionId: z.string().trim().max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  // Onboarding answers (US-14). Optional for older clients: missing = null =
  // legacy behavior. Anything outside the allowed values is rejected.
  locationsBand: z.enum(['1', '2-5', '6+']).nullish(),
  teamMode: z.enum(['solo', 'team']).nullish(),
  // Optional up front: NFC cards only ship once a restaurant converts (first
  // paid Mercado Pago payment), and /contacto hides the address behind a
  // collapsed "optional" toggle. Every field is optional so a partially filled
  // address never blocks an instant activation.
  shippingAddress: z
    .object({
      line1: z.string().max(300).optional(),
      line2: z.string().max(300).optional(),
      city: z.string().max(120).optional(),
      state: z.string().max(120).optional(),
      postalCode: z.string().max(20).optional(),
      notes: z.string().max(500).optional(),
    })
    .optional(),
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
  reviewedVia: z.enum(REVIEWED_VIA).optional(),
  resolution: z.enum(RESOLUTIONS).optional(),
}).superRefine((data, ctx) => {
  if (data.status === 'resolved' && !data.resolution) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['resolution'],
      message: 'Resolution is required when status is resolved',
    });
  }
});

// Quote builder POST/PUT body schema.
export const quoteCreateSchema = z.object({
  clientName: z.string().min(1).max(200),
  clientPhone: z.string().max(50).optional().nullable(),
  clientEmail: z.string().email().max(254).optional().nullable(),
  clientCompany: z.string().max(200).optional().nullable(),
  eventDate: z.string().max(40).optional().nullable(),
  eventType: z.string().max(80).optional().nullable(),
  guestCount: z.coerce.number().int().min(1).max(10000).default(1),
  eventNotes: z.string().max(5000).optional().nullable(),
  packageName: z.string().max(200).optional().nullable(),
  // Internal campaign grouping (e.g. "campaign:posadas-2026"). Not part of configJson:
  // the tag never reaches the public quote page. Empty string is normalized to
  // null by the API routes before it is written.
  campaignTag: z.string().trim().max(60).optional().nullable(),
  terms: z.string().max(20000).optional().nullable(),
  configJson: z.record(z.string(), z.unknown()),
  // Set when the quote originates from an event lead. Tenant ownership of the
  // lead is re-verified server-side before it is linked (see api/quotes).
  leadId: z.coerce.number().int().positive().optional().nullable(),
});

export const quoteUpdateSchema = quoteCreateSchema.extend({
  // Canonical quote vocabulary (lib/quote-status). 'won' is not settable here:
  // it needs outcome_at/outcome_amount_mxn (DB CHECK) and is written by the
  // lead-won flow.
  status: z.enum(QUOTE_STATUSES.filter((s) => s !== 'won') as ['draft', 'sent', 'declined', 'expired']).optional(),
});

// Manual event-lead entry from the dashboard (GM adds a walk-in / phone
// inquiry the bot didn't capture). source is forced to 'manual' server-side.
export const eventLeadManualSchema = z.object({
  name: z.string().max(200).optional().nullable(),
  phone: z
    .string()
    .min(7)
    .max(32)
    .regex(/^[\d+\s\-()]+$/, 'Teléfono inválido'),
  tipoEvento: z.string().max(120).optional().nullable(),
  pax: z.coerce.number().int().min(1).max(100000).optional().nullable(),
  fechaTentativa: z.string().max(120).optional().nullable(),
  presupuestoPp: z.string().max(120).optional().nullable(),
  prioridad: z.string().max(60).optional().nullable(),
  notasExtra: z.string().max(5000).optional().nullable(),
  urgente: z.boolean().optional().default(false),
});
