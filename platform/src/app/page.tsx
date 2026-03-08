import { db } from '@/db';
import { restaurants, reviews } from '@/db/schema';
import { count } from 'drizzle-orm';
import RestaurantCard from '@/components/dashboard/RestaurantCard';

async function getRestaurantsWithCounts() {
  const allRestaurants = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      createdAt: restaurants.createdAt,
    })
    .from(restaurants)
    .orderBy(restaurants.name);

  const counts = await db
    .select({
      restaurantId: reviews.restaurantId,
      total: count(reviews.id),
    })
    .from(reviews)
    .groupBy(reviews.restaurantId);

  const countMap = new Map(counts.map((c) => [c.restaurantId, c.total]));

  return allRestaurants.map((r) => ({
    ...r,
    reviewCount: countMap.get(r.id) ?? 0,
  }));
}

export default async function Home() {
  const data = await getRestaurantsWithCounts();

  return (
    <div className="min-h-dvh" style={{ background: 'var(--linen)' }}>
      {/* Header */}
      <header
        style={{
          background: 'var(--warm-white)',
          borderBottom: '1px solid var(--stone-200)',
        }}
      >
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logos/ratetap_logo.png"
              alt="RateTap"
              style={{ height: 48, objectFit: 'contain' }}
            />
          </div>
          <span
            className="text-sm font-medium px-3 py-1 rounded-full"
            style={{
              background: 'var(--stone-100)',
              color: 'var(--stone-500)',
            }}
          >
            {data.length} restaurant{data.length !== 1 && 's'}
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Restaurants */}
        <section className="mb-12">
          <h2
            className="text-xs font-semibold mb-5 tracking-[0.1em] uppercase"
            style={{ color: 'var(--stone-500)' }}
          >
            Restaurants
          </h2>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((r, i) => (
              <RestaurantCard
                key={r.id}
                name={r.name}
                slug={r.slug}
                reviewCount={r.reviewCount}
                index={i}
              />
            ))}
          </div>
        </section>

        {/* API Reference */}
        <section>
          <h2
            className="text-xs font-semibold mb-5 tracking-[0.1em] uppercase"
            style={{ color: 'var(--stone-500)' }}
          >
            API Reference
          </h2>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                label: 'Restaurants',
                desc: 'GET /api/restaurants',
                href: '/api/restaurants',
                note: 'Requires x-api-key',
              },
              {
                label: 'Staff',
                desc: 'GET /api/staff?restaurant=',
                href: '/api/staff?restaurant=estancia-angelopolis',
                note: 'Public',
              },
              {
                label: 'Settings',
                desc: 'GET /api/settings?restaurant=',
                href: '/api/settings?restaurant=estancia-angelopolis',
                note: 'Public',
              },
            ].map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="block transition-all duration-150 hover:shadow-sm"
                style={{
                  background: 'var(--warm-white)',
                  border: '1px solid var(--stone-200)',
                  borderRadius: 12,
                  padding: '18px 20px',
                }}
              >
                <span className="text-sm font-medium">{item.label}</span>
                <p
                  className="text-[12px] mt-1.5"
                  style={{ color: 'var(--stone-400)', fontFamily: 'monospace' }}
                >
                  {item.desc}
                </p>
                <p
                  className="text-[11px] mt-1"
                  style={{ color: 'var(--stone-400)' }}
                >
                  {item.note}
                </p>
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
