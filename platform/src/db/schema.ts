import {
  pgTable,
  serial,
  bigserial,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  unique,
  jsonb,
  numeric,
  date,
  uuid,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const reviewStatusEnum = pgEnum('review_status', [
  'new',
  'reviewed',
  'resolved',
]);

export const guestStatusEnum = pgEnum('guest_status', [
  'pending_validation',
  'validated',
  'expired',
]);

export const redemptionTypeEnum = pgEnum('redemption_type', [
  'copa_vino',
  'postre',
  'otro',
]);

export const restaurants = pgTable('restaurants', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  managerEmail: text('manager_email'),
  googleReviewUrl: text('google_review_url'),
  googleThreshold: integer('google_threshold').notNull().default(4),
  adminPasswordHash: text('admin_password_hash'),
  isOwner: boolean('is_owner').notNull().default(false),
  isRegional: boolean('is_regional').notNull().default(false),
  region: text('region'),
  // Brand slug ('estancia', 'harbors', etc.). Mirrors the in-memory lookup
  // in lib/brands.ts. Scopes guest-capture dedup and the agency-tier view.
  // Nullable on owner/regional rows since those aren't single-brand.
  brand: text('brand'),
  managerPhone: text('manager_phone'),
  alertPreference: text('alert_preference').notNull().default('all'),
  smsAlerts: boolean('sms_alerts').notNull().default(false),
  whatsappAlerts: boolean('whatsapp_alerts').notNull().default(false),
  callmebotApiKey: text('callmebot_api_key'),
  googlePlaceId: text('google_place_id'),
  googleRating: text('google_rating'),
  googleReviewCount: integer('google_review_count'),
  googleRatingUpdatedAt: timestamp('google_rating_updated_at', { withTimezone: true }),
  contactName: text('contact_name'),
  city: text('city'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  // 'stripe' | 'mercadopago' | NULL (manual/legacy). Set by whichever billing
  // provider most recently touched the subscription; never backfilled.
  billingProvider: text('billing_provider'),
  subscriptionStatus: text('subscription_status').notNull().default('active'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  pilot: boolean('pilot').notNull().default(false),
  shippingAddress: text('shipping_address'),
  nfcCardsShippedAt: timestamp('nfc_cards_shipped_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('password_reset_tokens_restaurant_idx').on(t.restaurantId),
    index('password_reset_tokens_expires_idx').on(t.expiresAt),
  ],
);

export const processedStripeEvents = pgTable('processed_stripe_events', {
  eventId: text('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Mercado Pago recurring subscriptions (preapproval). restaurants.id is a
// serial, so restaurantId is integer — matches migrations/0017_mercadopago.sql.
export const mercadopagoSubscriptions = pgTable(
  'mercadopago_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    // Nullable until Mercado Pago returns the preapproval id.
    preapprovalId: text('preapproval_id').unique(),
    externalReference: text('external_reference').notNull(),
    // Raw MP status: pending | authorized | paused | cancelled
    status: text('status').notNull().default('pending'),
    plan: text('plan').notNull().default('pro'),
    amount: numeric('amount', { precision: 10, scale: 2 }).notNull(),
    baseAmount: numeric('base_amount', { precision: 10, scale: 2 }),
    processingChargeAmount: numeric('processing_charge_amount', {
      precision: 10,
      scale: 2,
    }),
    taxAmount: numeric('tax_amount', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    totalAmount: numeric('total_amount', { precision: 10, scale: 2 }),
    billingStartsAt: timestamp('billing_starts_at', { withTimezone: true }),
    currency: text('currency').notNull().default('MXN'),
    payerEmail: text('payer_email'),
    nextPaymentDate: timestamp('next_payment_date', { withTimezone: true }),
    lastPaymentStatus: text('last_payment_status'),
    lastPaymentId: text('last_payment_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('mercadopago_subscriptions_restaurant_idx').on(t.restaurantId)],
);

export const processedMercadopagoEvents = pgTable('processed_mercadopago_events', {
  eventId: text('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const commercialLeads = pgTable(
  'commercial_leads',
  {
    id: serial('id').primaryKey(),
    name: text('name'),
    businessName: text('business_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    city: text('city'),
    source: text('source').notNull().default('unknown'),
    landingPath: text('landing_path'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmTerm: text('utm_term'),
    utmContent: text('utm_content'),
    offer: text('offer').notNull().default('unknown'),
    status: text('status').notNull().default('new'),
    nextAction: text('next_action'),
    nextActionAt: timestamp('next_action_at', { withTimezone: true }),
    contactedAt: timestamp('contacted_at', { withTimezone: true }),
    notes: text('notes'),
    lostReason: text('lost_reason'),
    wonAt: timestamp('won_at', { withTimezone: true }),
    lostAt: timestamp('lost_at', { withTimezone: true }),
    emailNormalized: text('email_normalized'),
    phoneNormalized: text('phone_normalized'),
    businessNameNormalized: text('business_name_normalized').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('commercial_leads_status_idx').on(t.status),
    index('commercial_leads_created_idx').on(t.createdAt),
    index('commercial_leads_next_action_idx').on(t.nextActionAt),
    index('commercial_leads_contacted_idx').on(t.contactedAt),
    index('commercial_leads_email_idx').on(t.emailNormalized),
    index('commercial_leads_phone_idx').on(t.phoneNormalized),
  ],
);

export const commercialEvents = pgTable(
  'commercial_events',
  {
    id: serial('id').primaryKey(),
    leadId: integer('lead_id').references(() => commercialLeads.id, { onDelete: 'set null' }),
    restaurantId: integer('restaurant_id').references(() => restaurants.id, { onDelete: 'set null' }),
    eventName: text('event_name').notNull(),
    source: text('source'),
    path: text('path'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('commercial_events_lead_idx').on(t.leadId),
    index('commercial_events_restaurant_idx').on(t.restaurantId),
    index('commercial_events_name_idx').on(t.eventName),
    index('commercial_events_created_idx').on(t.createdAt),
  ],
);

export const pendingSignups = pgTable(
  'pending_signups',
  {
    id: text('id').primaryKey(),
    statusTokenHash: text('status_token_hash').notNull(),
    checkoutSessionId: text('checkout_session_id').unique(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripeCustomerId: text('stripe_customer_id'),
    leadId: integer('lead_id').references(() => commercialLeads.id, { onDelete: 'set null' }),
    restaurantId: integer('restaurant_id').references(() => restaurants.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('checkout_started'),
    businessName: text('business_name').notNull(),
    contactName: text('contact_name'),
    email: text('email').notNull(),
    phone: text('phone'),
    city: text('city'),
    googlePlaceId: text('google_place_id'),
    passwordHash: text('password_hash').notNull(),
    shippingAddress: text('shipping_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('pending_signups_checkout_idx').on(t.checkoutSessionId),
    index('pending_signups_expires_idx').on(t.expiresAt),
    index('pending_signups_lead_idx').on(t.leadId),
    index('pending_signups_restaurant_idx').on(t.restaurantId),
  ],
);

export const staff = pgTable(
  'staff',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('staff_restaurant_id_idx').on(t.restaurantId),
    unique('staff_restaurant_code_uniq').on(t.restaurantId, t.code),
  ],
);

export const reviews = pgTable(
  'reviews',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    staffId: integer('staff_id').references(() => staff.id, {
      onDelete: 'set null',
    }),
    staffCode: text('staff_code'),
    staffName: text('staff_name'),
    rating: integer('rating').notNull(),
    feedbackTokenHash: text('feedback_token_hash'),
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    feedback: text('feedback'),
    status: reviewStatusEnum('status').notNull().default('new'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    sentToGoogle: boolean('sent_to_google').notNull().default(false),
    alertSentAt: timestamp('alert_sent_at', { withTimezone: true }),
    alertError: text('alert_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('reviews_restaurant_id_idx').on(t.restaurantId),
    index('reviews_staff_id_idx').on(t.staffId),
    index('reviews_created_at_idx').on(t.createdAt),
    index('reviews_restaurant_created_idx').on(t.restaurantId, t.createdAt),
    index('reviews_status_idx').on(t.status),
  ],
);

export const staffAttributionBackfill = pgTable(
  'staff_attribution_backfill',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    reviewId: integer('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    restaurantId: integer('restaurant_id').notNull(),
    oldStaffId: integer('old_staff_id'),
    oldStaffName: text('old_staff_name'),
    newStaffId: integer('new_staff_id').notNull(),
    newStaffName: text('new_staff_name').notNull(),
    matchedCode: text('matched_code').notNull(),
    originalStaffCode: text('original_staff_code').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('staff_attribution_backfill_review_idx').on(t.reviewId),
    index('staff_attribution_backfill_restaurant_applied_idx').on(
      t.restaurantId,
      t.appliedAt,
    ),
  ],
);

export const googleRatingSnapshots = pgTable(
  'google_rating_snapshots',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    rating: text('rating').notNull(),
    reviewCount: integer('review_count').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('snapshots_restaurant_id_idx').on(t.restaurantId),
    index('snapshots_captured_at_idx').on(t.capturedAt),
  ],
);

export const googleRatingSnapshotsRelations = relations(
  googleRatingSnapshots,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [googleRatingSnapshots.restaurantId],
      references: [restaurants.id],
    }),
  }),
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    role: text('role'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    deviceKind: text('device_kind'),
    userAgent: text('user_agent'),
    lastSubscribedAt: timestamp('last_subscribed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resubscribeCount: integer('resubscribe_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('push_subs_restaurant_id_idx').on(t.restaurantId),
    index('push_subs_restaurant_active_idx')
      .on(t.restaurantId)
      .where(sql`${t.revokedAt} is null`),
    unique('push_subs_endpoint_uniq').on(t.endpoint),
    check(
      'push_subs_revoked_reason_check',
      sql`${t.revokedReason} is null or ${t.revokedReason} in ('user_unsubscribe', 'endpoint_invalid', 'permission_revoked', 'unknown')`,
    ),
    check(
      'push_subs_device_kind_check',
      sql`${t.deviceKind} is null or ${t.deviceKind} in ('ios_pwa', 'ios_safari', 'android', 'desktop', 'unknown')`,
    ),
  ],
);

export const productEvents = pgTable(
  'product_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventName: text('event_name').notNull(),
    restaurantId: integer('restaurant_id').references(() => restaurants.id, {
      onDelete: 'set null',
    }),
    role: text('role'),
    staffId: integer('staff_id').references(() => staff.id, {
      onDelete: 'set null',
    }),
    sessionId: text('session_id'),
    path: text('path'),
    displayMode: text('display_mode'),
    properties: jsonb('properties')
      .notNull()
      .$type<Record<string, unknown>>()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('product_events_name_created_idx').on(t.eventName, t.createdAt),
    index('product_events_restaurant_created_idx').on(t.restaurantId, t.createdAt),
  ],
);

export const pushNotifications = pgTable(
  'push_notifications',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    subjectType: text('subject_type'),
    subjectId: integer('subject_id'),
    url: text('url').notNull(),
    subscriptionsTargeted: integer('subscriptions_targeted').notNull().default(0),
    acceptedCount: integer('accepted_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('push_notifications_restaurant_created_idx').on(t.restaurantId, t.createdAt),
  ],
);

export const prospectQueue = pgTable('prospect_queue', {
  placeId: text('place_id').primaryKey(),
  commercialLeadId: integer('commercial_lead_id').references(() => commercialLeads.id, { onDelete: 'set null' }),
  restaurantName: text('restaurant_name').notNull(),
  rating: text('rating'),
  reviewCount: integer('review_count'),
  phone: text('phone'),
  city: text('city'),
  status: text('status').notNull().default('identified'),
  deliveryStatus: text('delivery_status'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  contactedAt: timestamp('contacted_at', { withTimezone: true }),
  repliedAt: timestamp('replied_at', { withTimezone: true }),
  viewedAt: timestamp('viewed_at', { withTimezone: true }),
  lastOutreachAt: timestamp('last_outreach_at', { withTimezone: true }),
  lastFollowUpAt: timestamp('last_follow_up_at', { withTimezone: true }),
  nextActionAt: timestamp('next_action_at', { withTimezone: true }),
  followUpCount: integer('follow_up_count').notNull().default(0),
  replyText: text('reply_text'),
  bookedAt: timestamp('booked_at', { withTimezone: true }),
  wonAt: timestamp('won_at', { withTimezone: true }),
  lostAt: timestamp('lost_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('prospect_queue_commercial_lead_idx').on(t.commercialLeadId),
  index('prospect_queue_status_idx').on(t.status),
  index('prospect_queue_next_action_idx').on(t.nextActionAt),
  index('prospect_queue_provider_message_idx').on(t.providerMessageId),
]);

export const prospectOutreachEvents = pgTable(
  'prospect_outreach_events',
  {
    id: serial('id').primaryKey(),
    placeId: text('place_id').references(() => prospectQueue.placeId, { onDelete: 'set null' }),
    commercialLeadId: integer('commercial_lead_id').references(() => commercialLeads.id, { onDelete: 'set null' }),
    eventName: text('event_name').notNull(),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    status: text('status'),
    payload: jsonb('payload'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('prospect_outreach_events_place_idx').on(t.placeId),
    index('prospect_outreach_events_lead_idx').on(t.commercialLeadId),
    index('prospect_outreach_events_name_idx').on(t.eventName),
    index('prospect_outreach_events_created_idx').on(t.createdAt),
  ],
);

export const nurtureEvents = pgTable('nurture_events', {
  id: serial('id').primaryKey(),
  restaurantId: integer('restaurant_id').notNull().references(() => restaurants.id, { onDelete: 'cascade' }),
  event: text('event').notNull(), // 'day3', 'day7', 'day12'
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('nurture_restaurant_event_uniq').on(t.restaurantId, t.event)]);

export const prospectViews = pgTable('prospect_views', {
  placeId: text('place_id').primaryKey(),
  restaurantName: text('restaurant_name').notNull(),
  rating: text('rating'),
  viewCount: integer('view_count').notNull().default(1),
  firstViewAt: timestamp('first_view_at', { withTimezone: true }).notNull().defaultNow(),
  lastViewAt: timestamp('last_view_at', { withTimezone: true }).notNull().defaultNow(),
  lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
  lastFollowUpAt: timestamp('last_follow_up_at', { withTimezone: true }),
});

// Guest Capture CRM — phase 1 of the high-ticket tier. Dedup key: (whatsapp, brand).
// brand is denormalised from restaurants.brand so cross-location dedup within
// a brand doesn't require a join on every write.
export const guests = pgTable(
  'guests',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    brand: text('brand').notNull(),
    name: text('name').notNull(),
    whatsapp: text('whatsapp').notNull(),
    birthdayMmdd: text('birthday_mmdd'),
    preferences: text('preferences').array(),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    validationCode: text('validation_code'),
    validationCodeExpiresAt: timestamp('validation_code_expires_at', {
      withTimezone: true,
    }),
    status: guestStatusEnum('status').notNull().default('pending_validation'),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    validatedBy: integer('validated_by').references(() => staff.id, {
      onDelete: 'set null',
    }),
    redemptionType: redemptionTypeEnum('redemption_type'),
    promoType: text('promo_type'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    notes: text('notes'),
    metadata: jsonb('metadata'),
  },
  (t) => [
    unique('guests_whatsapp_brand_uniq').on(t.whatsapp, t.brand),
    index('guests_birthday_idx').on(t.birthdayMmdd),
    index('guests_restaurant_idx').on(t.restaurantId),
    index('guests_status_idx').on(t.status),
    index('guests_brand_idx').on(t.brand),
  ],
);

export const guestVisits = pgTable(
  'guest_visits',
  {
    id: serial('id').primaryKey(),
    guestId: integer('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    visitDate: timestamp('visit_date', { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text('notes'),
    loggedBy: integer('logged_by').references(() => staff.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('guest_visits_guest_idx').on(t.guestId),
    index('guest_visits_restaurant_idx').on(t.restaurantId),
  ],
);

// Relations
export const restaurantsRelations = relations(restaurants, ({ many }) => ({
  staff: many(staff),
  reviews: many(reviews),
  guests: many(guests),
}));

export const staffRelations = relations(staff, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [staff.restaurantId],
    references: [restaurants.id],
  }),
  reviews: many(reviews),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [reviews.restaurantId],
    references: [restaurants.id],
  }),
  staffMember: one(staff, {
    fields: [reviews.staffId],
    references: [staff.id],
  }),
}));

export const guestsRelations = relations(guests, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [guests.restaurantId],
    references: [restaurants.id],
  }),
  validatedByStaff: one(staff, {
    fields: [guests.validatedBy],
    references: [staff.id],
  }),
  visits: many(guestVisits),
}));

export const guestVisitsRelations = relations(guestVisits, ({ one }) => ({
  guest: one(guests, {
    fields: [guestVisits.guestId],
    references: [guests.id],
  }),
  restaurant: one(restaurants, {
    fields: [guestVisits.restaurantId],
    references: [restaurants.id],
  }),
  loggedByStaff: one(staff, {
    fields: [guestVisits.loggedBy],
    references: [staff.id],
  }),
}));

// ── Quote Builder ──────────────────────────────────────────────────────────

export const quotes = pgTable(
  'quotes',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    quoteNumber: text('quote_number'),
    status: text('status').notNull().default('draft'), // draft | sent | accepted | expired
    clientName: text('client_name').notNull(),
    clientPhone: text('client_phone'),
    clientEmail: text('client_email'),
    clientCompany: text('client_company'),
    eventDate: text('event_date'),
    eventType: text('event_type'),
    guestCount: integer('guest_count').notNull().default(1),
    eventNotes: text('event_notes'),
    pricePerPerson: text('price_per_person').notNull().default('0'),
    serviceChargePercent: text('service_charge_percent').notNull().default('10'),
    ivaPercent: text('iva_percent').notNull().default('16'),
    packageName: text('package_name'),
    terms: text('terms'),
    // Full builder state (modo + evento + per-mode state). Nullable for
    // legacy rows created before the V2 builder shipped.
    configJson: jsonb('config_json'),
    // Set when this quote was created from an event lead (/quotes/new?leadId).
    // Nullable: direct/manual quotes have no originating lead. SET NULL on lead
    // delete so the quote survives. See migrations/0011_quote_lead_link.sql.
    leadId: integer('lead_id').references(() => eventLeads.id, {
      onDelete: 'set null',
    }),
    // Client-facing delivery. publicToken is an unguessable share slug for the
    // read-only /q/[token] page; sentAt stamps the first WhatsApp send.
    // See migrations/0012_quote_public_token.sql.
    publicToken: text('public_token'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('quotes_restaurant_idx').on(t.restaurantId),
    index('quotes_created_at_idx').on(t.createdAt),
    index('quotes_status_idx').on(t.status),
    index('quotes_lead_idx').on(t.leadId),
    uniqueIndex('quotes_public_token_uniq').on(t.publicToken),
  ],
);

export const quoteItems = pgTable(
  'quote_items',
  {
    id: serial('id').primaryKey(),
    quoteId: integer('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    category: text('category').notNull(), // entrada|ensalada|corte|guarnicion|postre|bebida|vino|extra
    name: text('name').notNull(),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('quote_items_quote_idx').on(t.quoteId)],
);

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [quotes.restaurantId],
    references: [restaurants.id],
  }),
  items: many(quoteItems),
  lead: one(eventLeads, {
    fields: [quotes.leadId],
    references: [eventLeads.id],
  }),
}));

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  quote: one(quotes, {
    fields: [quoteItems.quoteId],
    references: [quotes.id],
  }),
}));

// ── Event Leads ────────────────────────────────────────────────────────────
// Qualified leads from the Manychat WhatsApp bot, with forward-compat for
// future sources (audit-page form, cotizador callback, manual). Body schema
// here mirrors the Manychat webhook payload one-to-one, plus the operational
// fields (restaurantId, status, claim).
//
// The dedup-key partial unique index `event_leads_dedup_uniq` on
// (source, phone, external_created_at) WHERE external_created_at IS NOT NULL
// is migration-managed — Drizzle's pgTable DSL doesn't express WHERE clauses
// on indexes yet. See migrations/0006_event_leads.sql.
export const eventLeads = pgTable(
  'event_leads',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    source: text('source').notNull(), // whatsapp_bot | audit | cotizador | manual
    phone: text('phone').notNull(),
    name: text('name'),
    tipoEvento: text('tipo_evento'),
    pax: integer('pax'),
    fechaTentativa: text('fecha_tentativa'), // raw user-typed per spec ("15 jun 2026" or "todavía no sé")
    presupuestoPp: text('presupuesto_pp'),
    prioridad: text('prioridad'),
    notasExtra: text('notas_extra'),
    urgente: boolean('urgente').notNull().default(false),
    rawConversation: text('raw_conversation'),
    status: text('status').notNull().default('new'), // new | claimed | quoted | won | lost
    claimedBy: integer('claimed_by').references(() => staff.id, {
      onDelete: 'set null',
    }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    externalCreatedAt: timestamp('external_created_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('event_leads_restaurant_idx').on(t.restaurantId),
    index('event_leads_status_idx').on(t.status),
    index('event_leads_restaurant_status_created_idx').on(
      t.restaurantId,
      t.status,
      t.createdAt,
    ),
  ],
);

export const eventLeadsRelations = relations(eventLeads, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [eventLeads.restaurantId],
    references: [restaurants.id],
  }),
  claimedByStaff: one(staff, {
    fields: [eventLeads.claimedBy],
    references: [staff.id],
  }),
}));

// ── Event revenue campaigns ────────────────────────────────────────────────

export const eventCampaigns = pgTable(
  'event_campaigns',
  {
    id: serial('id').primaryKey(),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    campaignType: text('campaign_type').notNull().default('house_event'),
    audienceRule: text('audience_rule').notNull().default('all_consented'),
    status: text('status').notNull().default('draft'),
    eventDate: date('event_date').notNull(),
    eventTime: text('event_time'),
    offerName: text('offer_name').notNull(),
    messageText: text('message_text').notNull(),
    pricePerPerson: numeric('price_per_person', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    capacity: integer('capacity').notNull().default(1),
    minimumSeats: integer('minimum_seats').notNull().default(0),
    baselineSeats: integer('baseline_seats').notNull().default(0),
    attributionDays: integer('attribution_days').notNull().default(30),
    feePercent: numeric('fee_percent', { precision: 5, scale: 2 })
      .notNull()
      .default('12'),
    audienceSeededAt: timestamp('audience_seeded_at', { withTimezone: true }),
    launchedAt: timestamp('launched_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('event_campaigns_restaurant_slug_uniq').on(t.restaurantId, t.slug),
    index('event_campaigns_restaurant_status_idx').on(t.restaurantId, t.status, t.eventDate),
  ],
);

export const campaignContacts = pgTable(
  'campaign_contacts',
  {
    id: serial('id').primaryKey(),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => eventCampaigns.id, { onDelete: 'cascade' }),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    guestId: integer('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    segment: text('segment').notNull(),
    priority: integer('priority').notNull().default(100),
    status: text('status').notNull().default('queued'),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    repliedAt: timestamp('replied_at', { withTimezone: true }),
    optedOutAt: timestamp('opted_out_at', { withTimezone: true }),
    lastActionAt: timestamp('last_action_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('campaign_contacts_campaign_guest_uniq').on(t.campaignId, t.guestId),
    index('campaign_contacts_campaign_status_idx').on(t.campaignId, t.status, t.priority),
    index('campaign_contacts_restaurant_idx').on(t.restaurantId),
  ],
);

export const campaignBookings = pgTable(
  'campaign_bookings',
  {
    id: serial('id').primaryKey(),
    campaignId: integer('campaign_id')
      .notNull()
      .references(() => eventCampaigns.id, { onDelete: 'cascade' }),
    restaurantId: integer('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    contactId: integer('contact_id').references(() => campaignContacts.id, { onDelete: 'set null' }),
    guestId: integer('guest_id').references(() => guests.id, { onDelete: 'set null' }),
    quoteId: integer('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
    eventLeadId: integer('event_lead_id').references(() => eventLeads.id, { onDelete: 'set null' }),
    clientName: text('client_name').notNull(),
    clientPhone: text('client_phone'),
    partySize: integer('party_size').notNull().default(1),
    status: text('status').notNull().default('inquiry'),
    attributionSource: text('attribution_source').notNull().default('direct'),
    attributionEvidence: text('attribution_evidence'),
    bookedAmount: numeric('booked_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    depositAmount: numeric('deposit_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    collectedAmount: numeric('collected_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    refundedAmount: numeric('refunded_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    ivaAmount: numeric('iva_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    serviceChargeAmount: numeric('service_charge_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    gratuityAmount: numeric('gratuity_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    eligibleRevenue: numeric('eligible_revenue', { precision: 12, scale: 2 }).notNull().default('0'),
    feeAmount: numeric('fee_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    depositReceivedAt: timestamp('deposit_received_at', { withTimezone: true }),
    bookedAt: timestamp('booked_at', { withTimezone: true }),
    attendedAt: timestamp('attended_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('campaign_bookings_campaign_status_idx').on(t.campaignId, t.status, t.createdAt),
    index('campaign_bookings_restaurant_idx').on(t.restaurantId),
    index('campaign_bookings_contact_idx').on(t.contactId),
  ],
);

export const eventCampaignsRelations = relations(eventCampaigns, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [eventCampaigns.restaurantId],
    references: [restaurants.id],
  }),
  contacts: many(campaignContacts),
  bookings: many(campaignBookings),
}));

export const campaignContactsRelations = relations(campaignContacts, ({ one, many }) => ({
  campaign: one(eventCampaigns, {
    fields: [campaignContacts.campaignId],
    references: [eventCampaigns.id],
  }),
  guest: one(guests, {
    fields: [campaignContacts.guestId],
    references: [guests.id],
  }),
  bookings: many(campaignBookings),
}));

export const campaignBookingsRelations = relations(campaignBookings, ({ one }) => ({
  campaign: one(eventCampaigns, {
    fields: [campaignBookings.campaignId],
    references: [eventCampaigns.id],
  }),
  contact: one(campaignContacts, {
    fields: [campaignBookings.contactId],
    references: [campaignContacts.id],
  }),
  guest: one(guests, {
    fields: [campaignBookings.guestId],
    references: [guests.id],
  }),
  quote: one(quotes, {
    fields: [campaignBookings.quoteId],
    references: [quotes.id],
  }),
  eventLead: one(eventLeads, {
    fields: [campaignBookings.eventLeadId],
    references: [eventLeads.id],
  }),
}));

// ── Outbound email outreach ────────────────────────────────────────────────

export const outreachProspectKindEnum = pgEnum('outreach_prospect_kind', [
  'leon',
  'group',
]);

export const outreachProspectStatusEnum = pgEnum('outreach_prospect_status', [
  'queued',
  'in_sequence',
  'finished',
  'replied',
  'opted_out',
]);

export const outreachEventTypeEnum = pgEnum('outreach_event_type', [
  'sent',
  'failed',
  'unsubscribed',
  'audit_viewed',
  'alerted',
]);

export const outreachProspects = pgTable(
  'outreach_prospects',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    kind: outreachProspectKindEnum('kind').notNull(),
    placeId: text('place_id'),
    phone: text('phone'),
    city: text('city'),
    rating: numeric('rating'),
    sourceUrl: text('source_url'),
    confidence: text('confidence'),
    status: outreachProspectStatusEnum('status').notNull().default('queued'),
    touchesSent: integer('touches_sent').notNull().default(0),
    lastTouchAt: timestamp('last_touch_at', { withTimezone: true }),
    nextTouchAt: timestamp('next_touch_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('outreach_prospects_status_idx').on(t.status),
    index('outreach_prospects_kind_idx').on(t.kind),
    index('outreach_prospects_next_touch_idx').on(t.nextTouchAt),
    index('outreach_prospects_email_idx').on(t.email),
  ],
);

export const outreachEvents = pgTable(
  'outreach_events',
  {
    id: serial('id').primaryKey(),
    prospectId: integer('prospect_id')
      .notNull()
      .references(() => outreachProspects.id, { onDelete: 'cascade' }),
    type: outreachEventTypeEnum('type').notNull(),
    touchNumber: integer('touch_number'),
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('outreach_events_prospect_idx').on(t.prospectId),
    index('outreach_events_type_idx').on(t.type),
    index('outreach_events_created_idx').on(t.createdAt),
  ],
);

export const outreachProspectsRelations = relations(outreachProspects, ({ many }) => ({
  events: many(outreachEvents),
}));

export const outreachEventsRelations = relations(outreachEvents, ({ one }) => ({
  prospect: one(outreachProspects, {
    fields: [outreachEvents.prospectId],
    references: [outreachProspects.id],
  }),
}));
