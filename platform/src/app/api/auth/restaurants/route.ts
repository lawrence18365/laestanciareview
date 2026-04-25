import { db } from '@/db';
import { restaurants } from '@/db/schema';

/**
 * Public endpoint: returns restaurant names and slugs for the login form.
 *
 * Note: this discloses the full account list to anonymous callers. Owners and
 * regional managers are kept in the response because the login page renders
 * the list as a <select> — excluding them would lock those accounts out of
 * the dashboard. DB IDs are not returned.
 */
export async function GET() {
  const list = await db
    .select({
      name: restaurants.name,
      slug: restaurants.slug,
    })
    .from(restaurants)
    .orderBy(restaurants.name);

  return Response.json(list);
}
