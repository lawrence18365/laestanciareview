import { NextRequest } from 'next/server';
import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { requireAdminKey, unauthorizedResponse, hashPassword } from '@/lib/auth';
import { createRestaurantSchema } from '@/lib/validations';

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

  const { adminPassword, ...data } = parsed.data;

  const values: typeof restaurants.$inferInsert = {
    ...data,
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
