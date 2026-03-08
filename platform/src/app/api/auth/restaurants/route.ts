import { db } from '@/db';
import { restaurants } from '@/db/schema';

/** Public endpoint: returns restaurant names and slugs for the login form. */
export async function GET() {
  const list = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
    })
    .from(restaurants)
    .orderBy(restaurants.name);

  return Response.json(list);
}
