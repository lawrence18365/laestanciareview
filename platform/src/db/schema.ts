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
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const reviewStatusEnum = pgEnum('review_status', [
  'new',
  'reviewed',
  'resolved',
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
  managerPhone: text('manager_phone'),
  alertPreference: text('alert_preference').notNull().default('all'),
  smsAlerts: boolean('sms_alerts').notNull().default(false),
  googlePlaceId: text('google_place_id'),
  googleRating: text('google_rating'),
  googleReviewCount: integer('google_review_count'),
  googleRatingUpdatedAt: timestamp('google_rating_updated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
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

// Relations
export const restaurantsRelations = relations(restaurants, ({ many }) => ({
  staff: many(staff),
  reviews: many(reviews),
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
