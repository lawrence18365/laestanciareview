/**
 * One-off: give existing self-serve restaurants (group_key NULL) their one
 * category+city Maps rank keyword and run a single sweep for each (about 10
 * Places calls per restaurant). Skips restaurants that already have a keyword.
 * Dry run by default. Pass --apply to insert and sweep (the sweep also needs
 * MAPS_RANK_ENABLED=true and GOOGLE_PLACES_API_KEY).
 *
 * --fix-category (SQ-223): instead of the above, find self-serve restaurants
 * whose stored active keyword differs from the keyword derived today (the
 * business's own Google category, e.g. "dentista Tecate" instead of
 * "restaurante Tecate"). Prints slug, old, new. When the stored google_profile
 * has no primaryTypeLabel, fetches primaryTypeDisplayName (es) for that place
 * id (one Place Details call each, read only). Dry run by default; --apply
 * deactivates the old keyword row and inserts (or re-activates) the new one.
 * No sweep is run: the next scheduled sweep samples the new keyword.
 */
import { config } from 'dotenv';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile });

async function fetchPrimaryTypeLabel(placeId: string, key: string): Promise<string | null> {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=es`,
    { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'primaryTypeDisplayName' } },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { primaryTypeDisplayName?: { text?: unknown } };
  const text = body.primaryTypeDisplayName?.text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

async function main() {
  // Imported after dotenv so DATABASE_URL is set when the db client initializes.
  const { db } = await import('@/db');
  const { restaurants, mapsRankKeywords } = await import('@/db/schema');
  const { and, eq, isNotNull, isNull } = await import('drizzle-orm');
  const { defaultKeywords } = await import('@/lib/maps-rank-keywords');
  const { runMapsRankSweep } = await import('@/lib/maps-rank');

  const apply = process.argv.includes('--apply');
  const fixCategory = process.argv.includes('--fix-category');
  if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL missing — is ${envFile} loaded?`);

  const rows = await db
    .select({
      id: restaurants.id,
      slug: restaurants.slug,
      name: restaurants.name,
      city: restaurants.city,
      googlePlaceId: restaurants.googlePlaceId,
      googleProfile: restaurants.googleProfile,
    })
    .from(restaurants)
    .where(
      and(
        isNull(restaurants.groupKey),
        isNotNull(restaurants.googlePlaceId),
        isNotNull(restaurants.city),
        eq(restaurants.isOwner, false),
        eq(restaurants.isRegional, false),
      ),
    );

  if (fixCategory) {
    const { placesApiKey } = await import('@/lib/competitors');
    const { parseGoogleProfile } = await import('@/lib/onboarding-profile');
    const key = placesApiKey();

    const keywordRows = await db.select().from(mapsRankKeywords).where(eq(mapsRankKeywords.active, true));
    const activeByRestaurant = new Map<number, string[]>();
    for (const k of keywordRows) {
      activeByRestaurant.set(k.restaurantId, [...(activeByRestaurant.get(k.restaurantId) ?? []), k.keyword]);
    }

    const fixes: Array<{ id: number; slug: string; old: string; next: string }> = [];
    for (const r of rows) {
      const active = activeByRestaurant.get(r.id) ?? [];
      if (active.length === 0) continue;

      let profile: unknown = r.googleProfile;
      const parsed = parseGoogleProfile(r.googleProfile);
      if (parsed && !parsed.primaryTypeLabel && key && r.googlePlaceId) {
        const label = await fetchPrimaryTypeLabel(r.googlePlaceId, key).catch(() => null);
        if (label) profile = { ...(r.googleProfile as Record<string, unknown>), primaryTypeLabel: label };
      }
      const next = defaultKeywords({ city: r.city, brand: null, groupKey: null, googleProfile: profile })[0];
      if (!next || active.includes(next)) continue;
      if (active.length > 1) {
        console.log(`${r.slug}\tskipped: ${active.length} active keywords (${active.join(' | ')}); curated by hand?`);
        continue;
      }
      fixes.push({ id: r.id, slug: r.slug, old: active[0], next });
    }

    for (const f of fixes) console.log(`${f.slug}\t${f.old}\t${f.next}`);
    console.log(`${fixes.length} restaurants with a different category keyword`);
    if (!apply) {
      console.log('Dry run. Pass --apply to deactivate the old keyword row and insert the new one.');
      return;
    }
    for (const f of fixes) {
      await db
        .update(mapsRankKeywords)
        .set({ active: false })
        .where(and(eq(mapsRankKeywords.restaurantId, f.id), eq(mapsRankKeywords.keyword, f.old)));
      await db
        .insert(mapsRankKeywords)
        .values({ restaurantId: f.id, keyword: f.next })
        .onConflictDoUpdate({
          target: [mapsRankKeywords.restaurantId, mapsRankKeywords.keyword],
          set: { active: true },
        });
    }
    console.log(`Applied ${fixes.length} keyword swaps. No sweep run.`);
    return;
  }

  const have = new Set(
    (await db.select({ id: mapsRankKeywords.restaurantId }).from(mapsRankKeywords)).map((k) => k.id),
  );

  const plan = rows
    .filter((r) => !have.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      keywords: defaultKeywords({ city: r.city, brand: null, groupKey: null, googleProfile: r.googleProfile }),
    }))
    .filter((r) => r.keywords.length > 0);

  for (const r of plan) {
    console.log(`${r.id}\t${r.name}\t${r.keywords.join(' | ')}`);
  }
  console.log(`${plan.length} restaurants, ${plan.reduce((n, r) => n + r.keywords.length, 0)} keywords`);

  if (!apply) {
    console.log('Dry run. Pass --apply to insert and sweep.');
    return;
  }

  const values = plan.flatMap((r) =>
    r.keywords.map((keyword) => ({ restaurantId: r.id, keyword })),
  );
  if (values.length > 0) {
    await db.insert(mapsRankKeywords).values(values).onConflictDoNothing();
  }
  console.log(`Applied ${values.length} keyword rows (conflicts skipped).`);

  if (process.env.MAPS_RANK_ENABLED !== 'true') {
    console.log('MAPS_RANK_ENABLED is not true: keywords saved, no sweep run.');
    return;
  }
  for (const r of plan) {
    const result = await runMapsRankSweep({ restaurantId: r.id, force: true });
    console.log(`${r.id}\tsamples=${result.samples}\tfailed=${result.failed}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
