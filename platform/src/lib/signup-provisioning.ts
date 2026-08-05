import { db, transactionDb } from '@/db';
import { pendingSignups, restaurants } from '@/db/schema';
import { generateUniqueSlug, slugify } from '@/lib/slug';
import { and, eq, sql } from 'drizzle-orm';

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
      googleReviewUrl: input.googlePlaceId
        ? `https://search.google.com/local/writereview?placeid=${input.googlePlaceId}`
        : null,
      adminPasswordHash: input.passwordHash,
      shippingAddress: input.shippingAddress ?? null,
      stripeCustomerId: input.stripeCustomerId ?? null,
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      subscriptionStatus: 'trialing',
      trialEndsAt: input.trialEndsAt,
      pilot: input.pilot ?? false,
    })
    .returning({ id: restaurants.id });

  return { id: restaurant.id, slug };
}

export async function provisionPilotSignupAtomic(
  input: SignupRestaurantInput & { pendingSignupId: string; leadId: number },
) {
  return transactionDb.transaction(async (tx) => {
    // Match the migration trigger's advisory lock. Taking it before the
    // idempotency lookup serializes concurrent pilot retries and refreshes the
    // READ COMMITTED snapshot before any account state is inspected.
    await tx.execute(sql`select pg_advisory_xact_lock(72401501)`);

    const [existing] = await tx
      .select({ id: restaurants.id, slug: restaurants.slug })
      .from(pendingSignups)
      .innerJoin(restaurants, eq(pendingSignups.restaurantId, restaurants.id))
      .where(and(
        eq(pendingSignups.leadId, input.leadId),
        eq(restaurants.pilot, true),
      ))
      .limit(1);

    let restaurant = existing;
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
          googleReviewUrl: input.googlePlaceId
            ? `https://search.google.com/local/writereview?placeid=${input.googlePlaceId}`
            : null,
          adminPasswordHash: input.passwordHash,
          shippingAddress: input.shippingAddress ?? null,
          subscriptionStatus: 'trialing',
          trialEndsAt: input.trialEndsAt,
          pilot: true,
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
