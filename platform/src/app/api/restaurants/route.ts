import { NextRequest } from 'next/server';
import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { requireAdminKey, unauthorizedResponse, hashPassword } from '@/lib/auth';
import { createRestaurantSchema } from '@/lib/validations';
import { verifySession } from '@/lib/session';
import { getGroupKeyBySlug } from '@/lib/queries';

export async function GET(req: NextRequest) {
  if (!requireAdminKey(req)) return unauthorizedResponse();

  const list = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      slug: restaurants.slug,
      managerEmail: restaurants.managerEmail,
      googleThreshold: restaurants.googleThreshold,
      createdAt: restaurants.createdAt,
    })
    .from(restaurants)
    .orderBy(restaurants.name);

  return Response.json({ restaurants: list });
}

export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = createRestaurantSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { adminPassword, groupKey, ...data } = parsed.data;

  // An owner or regional session creates inside its own group. The group is
  // read from the DB by slug, never taken from the body, and a different
  // explicit groupKey is refused.
  let resolvedGroupKey = groupKey ?? null;
  const session = await verifySession();
  if (session && (session.role === 'owner' || session.role === 'regional')) {
    const ownGroup = await getGroupKeyBySlug(session.slug);
    if (groupKey !== undefined && groupKey !== ownGroup) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    resolvedGroupKey = ownGroup;
  }

  const values: typeof restaurants.$inferInsert = {
    ...data,
    groupKey: resolvedGroupKey,
    adminPasswordHash: adminPassword
      ? await hashPassword(adminPassword)
      : null,
  };

  const [created] = await db
    .insert(restaurants)
    .values(values)
    .returning();

  return Response.json(
    {
      restaurant: {
        id: created.id,
        name: created.name,
        slug: created.slug,
      },
    },
    { status: 201 },
  );
}
