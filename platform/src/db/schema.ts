import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  index,
  unique,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
  subscriptionStatus: text('subscription_status').notNull().default('active'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  shippingAddress: text('shipping_address'),
  nfcCardsShippedAt: timestamp('nfc_cards_shipped_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const processedStripeEvents = pgTable('processed_stripe_events', {
  eventId: text('event_id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    feedback: text('feedback'),
    status: reviewStatusEnum('status').notNull().default('new'),
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('push_subs_restaurant_id_idx').on(t.restaurantId),
    unique('push_subs_endpoint_uniq').on(t.endpoint),
  ],
);

export const prospectQueue = pgTable('prospect_queue', {
  placeId: text('place_id').primaryKey(),
  restaurantName: text('restaurant_name').notNull(),
  rating: text('rating'),
  reviewCount: integer('review_count'),
  phone: text('phone'),
  city: text('city'),
  status: text('status').notNull().default('pending'),
  contactedAt: timestamp('contacted_at', { withTimezone: true }),
  repliedAt: timestamp('replied_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('quotes_restaurant_idx').on(t.restaurantId),
    index('quotes_created_at_idx').on(t.createdAt),
    index('quotes_status_idx').on(t.status),
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
}));

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  quote: one(quotes, {
    fields: [quoteItems.quoteId],
    references: [quotes.id],
  }),
}));
