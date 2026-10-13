import { db, transactionDb } from '@/db';
import { googleRatingSnapshots, mapsRankKeywords, pendingSignups, restaurants } from '@/db/schema';
import { defaultKeywords } from '@/lib/maps-rank-keywords';
import { runMapsRankSweep } from '@/lib/maps-rank';
import { fetchOnboardingGoogleData, type OnboardingGoogleData } from '@/lib/google-onboarding';
import { generateUniqueSlug, slugify } from '@/lib/slug';
import { reviewUrlFor } from '@/lib/google-review';
import type { LocationsBand, TeamMode } from '@/lib/onboarding-profile';
import { detectChain } from '@/lib/chain-detect';
import { sendChainSignupAlert } from '@/lib/email';
import { after } from 'next/server';
import { and, eq, isNull, sql } from 'drizzle-orm';

/** A name on this many Google locations is probably a chain (US-15 M5). */
export const CHAIN_ALERT_THRESHOLD = 3;

export type ChainCheckInput = {
  id: number;
  slug: string;
  name: string;
  groupKey: string | null;
  googlePlaceId?: string | null;
  city?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
};

/**
 * Chain detection for one self-serve restaurant: store `chainCount` in
 * `google_profile` (jsonb merge) and, at 3+ locations, tell the founders.
 * Never throws. Group restaurants (`group_key` set) are never processed.
 * Returns the detected count, or null when nothing was detected.
 */
export async function recordChainDetection(r: ChainCheckInput): Promise<number | null> {
  if (r.groupKey !== null) return null;
  try {
    const chain = await detectChain(r.name, r.googlePlaceId ?? '');
    if (!chain) return null;
    await db
      .update(restaurants)
      .set({
        googleProfile: sql`(case when jsonb_typeof(${restaurants.googleProfile}) = 'object' then ${restaurants.googleProfile} else '{}'::jsonb end) || ${JSON.stringify({ chainCount: chain.count })}::jsonb`,
      })
      .where(and(eq(restaurants.id, r.id), isNull(restaurants.groupKey)));
    if (chain.count >= CHAIN_ALERT_THRESHOLD) {
      await sendChainSignupAlert({
        restaurantName: r.name,
        contactName: r.contactName ?? '',
        email: r.email ?? '',
        phone: r.phone ?? '',
        city: r.city ?? '',
        slug: r.slug,
        count: chain.count,
        addresses: chain.sampleAddresses,
      });
    }
    return chain.count;
  } catch (err) {
    console.error('[chain-detect] record failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fire-and-forget: runs after the response where Next allows it, detached otherwise. */
function runAfterResponse(run: () => Promise<void>) {
  try {
    after(run);
  } catch {
    // `after()` throws outside a Next.js request scope (unit tests, scripts).
    void run();
  }
}

function scheduleChainDetection(r: ChainCheckInput) {
  runAfterResponse(async () => {
    await recordChainDetection(r);
  });
}

/**
 * Maps rank for a brand-new self-serve restaurant: store its one
 * category+city keyword and run a single forced sweep for it so the dashboard
 * has data on day one (about 10 Places calls; later runs are the weekly sweep,
 * trial/paid only). Does nothing unless MAPS_RANK_ENABLED=true. Never throws.
 */
export async function setupSelfServeMapsRank(r: {
  id: number;
  city?: string | null;
  googlePlaceId?: string | null;
  googleProfile?: unknown;
}): Promise<void> {
  if (process.env.MAPS_RANK_ENABLED !== 'true') return;
  if (!r.googlePlaceId) return;
  try {
    const keywords = defaultKeywords({
      city: r.city ?? null,
      brand: null,
      groupKey: null,
      googleProfile: r.googleProfile,
    });
    if (keywords.length === 0) return;
    await db
      .insert(mapsRankKeywords)
      .values(keywords.map((keyword) => ({ restaurantId: r.id, keyword })))
      .onConflictDoNothing();
    await runMapsRankSweep({ restaurantId: r.id, force: true });
  } catch (err) {
    console.error('[maps-rank] signup setup failed:', err instanceof Error ? err.name : 'unknown');
  }
}

function scheduleMapsRankSetup(r: Parameters<typeof setupSelfServeMapsRank>[0]) {
  runAfterResponse(() => setupSelfServeMapsRank(r));
}

/**
 * Thrown by `provisionSignupAtomic` when the lead it was handed is already
 * linked to an account whose manager email is NOT the one being provisioned.
 *
 * Commercial leads are deduped by phone + business name (see
 * `commercialLeadDedupeKey`), not by email, so anyone who knows a restaurant's
 * public phone and name can land on that restaurant's lead — and, without this
 * check, be handed its account. Only the same email may reuse an account.
 */
export class SignupConflictError extends Error {
  constructor() {
    super('signup_conflict_existing_account');
    this.name = 'SignupConflictError';
  }
}

export type SignupRestaurantInput = {
  businessName: string;
  contactName?: string | null;
  email: string;
  phone?: string | null;
  city?: string | null;
  googlePlaceId?: string | null;
  passwordHash: string;
  shippingAddress?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  trialEndsAt: Date;
  pilot?: boolean;
  /** Onboarding answers (US-14). Omitted/null = legacy behavior. */
  teamMode?: TeamMode | null;
  locationsBand?: LocationsBand | null;
};

/**
 * Google numbers for the restaurant row. Empty when there is no place ID or
 * the (time-capped, never-throwing) fetch failed, so signup always proceeds.
 */
async function googleColumns(placeId: string | null | undefined) {
  const data: OnboardingGoogleData | null = placeId
    ? await fetchOnboardingGoogleData(placeId)
    : null;
  if (!data || (data.rating === null && data.profile === null)) {
    return { data: null, values: {} };
  }
  return {
    data,
    values: {
      googleRating: data.rating,
      googleReviewCount: data.reviewCount,
      googleRatingUpdatedAt: data.rating !== null ? new Date() : null,
      googleProfile: data.profile,
    },
  };
}

/**
 * One baseline row in google_rating_snapshots for the brand-new restaurant.
 * No same-day check is needed: the restaurant id was created a moment ago, so
 * it has no snapshot yet, and `captured_at` (now) is today in Mexico time.
 */
function baselineSnapshot(restaurantId: number, data: OnboardingGoogleData | null) {
  if (!data || data.rating === null || data.reviewCount === null) return null;
  return { restaurantId, rating: data.rating, reviewCount: data.reviewCount };
}

export async function provisionSignupRestaurant(input: SignupRestaurantInput) {
  const slug = await generateUniqueSlug(input.businessName);
  const google = await googleColumns(input.googlePlaceId);

  const [restaurant] = await db
    .insert(restaurants)
    .values({
      name: input.businessName,
      slug,
      managerEmail: input.email,
      contactName: input.contactName ?? null,
      city: input.city ?? null,
      managerPhone: input.phone ?? null,
      googlePlaceId: input.googlePlaceId || null,
      googleReviewUrl: reviewUrlFor({
        googleReviewUrl: null,
        googlePlaceId: input.googlePlaceId ?? null,
      }),
      adminPasswordHash: input.passwordHash,
      shippingAddress: input.shippingAddress ?? null,
      // Explicitly NULL: a self-serve trial is its own island, never part of
      // an owner/regional group view, digest or escalation (see group-scope).
      groupKey: null,
      teamMode: input.teamMode ?? null,
      locationsBand: input.locationsBand ?? null,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      subscriptionStatus: 'trialing',
      trialEndsAt: input.trialEndsAt,
      pilot: input.pilot ?? false,
      ...google.values,
    })
    .returning({ id: restaurants.id });

  const baseline = baselineSnapshot(restaurant.id, google.data);
  if (baseline) {
    try {
      await db.insert(googleRatingSnapshots).values(baseline);
    } catch {
      // The baseline is a nicety; never fail signup over it.
    }
  }

  scheduleChainDetection({
    id: restaurant.id,
    slug,
    name: input.businessName,
    groupKey: null,
    googlePlaceId: input.googlePlaceId,
    city: input.city,
    contactName: input.contactName,
    email: input.email,
    phone: input.phone,
  });
  scheduleMapsRankSetup({
    id: restaurant.id,
    city: input.city,
    googlePlaceId: input.googlePlaceId,
    googleProfile: google.data?.profile,
  });

  return { id: restaurant.id, slug };
}

/**
 * Provision a restaurant in one transaction, immediately (no payment step).
 *
 * Used by both the invite-only founder pilot (`pilot: true`, capped at 5 by a
 * DB trigger) and the public self-serve trial (`pilot: false`, not counted by
 * that cap). Re-submitting the same lead with the same email is idempotent: it
 * returns the already-provisioned restaurant instead of creating a second one.
 * A different email on that lead throws `SignupConflictError` instead.
 */
export async function provisionSignupAtomic(
  input: SignupRestaurantInput & { pendingSignupId: string; leadId: number },
) {
  const pilot = input.pilot ?? false;
  // Fetched before the transaction: it holds a global advisory lock, and the
  // 3s Google budget must not be spent inside it.
  const google = await googleColumns(input.googlePlaceId);

  let created = false;
  const restaurant = await transactionDb.transaction(async (tx) => {
    // Match the migration trigger's advisory lock. Taking it before the
    // idempotency lookup serializes concurrent retries and refreshes the
    // READ COMMITTED snapshot before any account state is inspected. For
    // pilot rows it also serializes against the five-redemption cap trigger.
    await tx.execute(sql`select pg_advisory_xact_lock(72401501)`);

    const [existing] = await tx
      .select({
        id: restaurants.id,
        slug: restaurants.slug,
        managerEmail: restaurants.managerEmail,
      })
      .from(pendingSignups)
      .innerJoin(restaurants, eq(pendingSignups.restaurantId, restaurants.id))
      .where(and(
        eq(pendingSignups.leadId, input.leadId),
        eq(restaurants.pilot, pilot),
      ))
      .limit(1);

    // Idempotency is only ever "the same account submitted twice". The lead is
    // deduped by phone + business name, so a DIFFERENT email on the same lead
    // is an attempt to take over someone else's restaurant: refuse instead of
    // attaching that restaurant (and a session for it) to this email. A null
    // manager email counts as "not equal" — never hand out an account we
    // cannot prove belongs to this email.
    if (
      existing &&
      (existing.managerEmail ?? '').trim().toLowerCase() !==
        input.email.trim().toLowerCase()
    ) {
      throw new SignupConflictError();
    }

    let restaurant: { id: number; slug: string } | undefined = existing
      ? { id: existing.id, slug: existing.slug }
      : undefined;
    if (!restaurant) {
      const baseSlug = slugify(input.businessName);
      let slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
      for (let i = 0; i < 50; i++) {
        const candidate = i === 0 ? baseSlug : `${baseSlug}-${i + 1}`;
        const rows = await tx
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(eq(restaurants.slug, candidate))
          .limit(1);
        if (rows.length === 0) {
          slug = candidate;
          break;
        }
      }

      [restaurant] = await tx
        .insert(restaurants)
        .values({
          name: input.businessName,
          slug,
          managerEmail: input.email,
          contactName: input.contactName ?? null,
          city: input.city ?? null,
          managerPhone: input.phone ?? null,
          googlePlaceId: input.googlePlaceId || null,
          googleReviewUrl: reviewUrlFor({
            googleReviewUrl: null,
            googlePlaceId: input.googlePlaceId ?? null,
          }),
          adminPasswordHash: input.passwordHash,
          shippingAddress: input.shippingAddress ?? null,
          // Explicitly NULL: its own island, see provisionSignupRestaurant.
          groupKey: null,
          teamMode: input.teamMode ?? null,
          locationsBand: input.locationsBand ?? null,
          subscriptionStatus: 'trialing',
          trialEndsAt: input.trialEndsAt,
          pilot,
          ...google.values,
        })
        .returning({ id: restaurants.id, slug: restaurants.slug });

      const baseline = baselineSnapshot(restaurant.id, google.data);
      if (baseline) await tx.insert(googleRatingSnapshots).values(baseline);
      created = true;
    }

    await tx
      .update(pendingSignups)
      .set({
        status: 'provisioned',
        restaurantId: restaurant.id,
        completedAt: new Date(),
      })
      .where(eq(pendingSignups.id, input.pendingSignupId));

    return restaurant;
  });

  // Only a restaurant created by this call; an idempotent re-submit is not re-checked.
  if (created) {
    scheduleChainDetection({
      id: restaurant.id,
      slug: restaurant.slug,
      name: input.businessName,
      groupKey: null,
      googlePlaceId: input.googlePlaceId,
      city: input.city,
      contactName: input.contactName,
      email: input.email,
      phone: input.phone,
    });
    scheduleMapsRankSetup({
      id: restaurant.id,
      city: input.city,
      googlePlaceId: input.googlePlaceId,
      googleProfile: google.data?.profile,
    });
  }
  return restaurant;
}
