import { db, transactionDb } from '@/db';
import { pendingSignups, restaurants } from '@/db/schema';
import { generateUniqueSlug, slugify } from '@/lib/slug';
import { reviewUrlFor } from '@/lib/google-review';
import { and, eq, sql } from 'drizzle-orm';

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
};

export async function provisionSignupRestaurant(input: SignupRestaurantInput) {
  const slug = await generateUniqueSlug(input.businessName);

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
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      subscriptionStatus: 'trialing',
      trialEndsAt: input.trialEndsAt,
      pilot: input.pilot ?? false,
    })
    .returning({ id: restaurants.id });

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

  return transactionDb.transaction(async (tx) => {
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
          subscriptionStatus: 'trialing',
          trialEndsAt: input.trialEndsAt,
          pilot,
        })
        .returning({ id: restaurants.id, slug: restaurants.slug });
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
}
