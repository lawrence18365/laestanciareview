import { db } from '@/db';
import { staff } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug, getStaffList } from '@/lib/queries';
import {
  sessionStaffCreateSchema,
  sessionStaffUpdateSchema,
  sessionStaffDeleteSchema,
} from '@/lib/validations';
import { requireSameOrigin } from '@/lib/origin';

export async function GET() {
  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  const list = await getStaffList(restaurant.id);
  return Response.json({ staff: list });
}

export async function POST(req: Request) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = sessionStaffCreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [created] = await db
    .insert(staff)
    .values({
      restaurantId: restaurant.id,
      name: parsed.data.name.trim(),
      code: parsed.data.code.trim(),
    })
    .returning();

  return Response.json({ staff: created }, { status: 201 });
}

export async function PATCH(req: Request) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = sessionStaffUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name.trim();
  if (parsed.data.code !== undefined) updates.code = parsed.data.code.trim();
  if (parsed.data.active !== undefined) updates.active = parsed.data.active;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields' }, { status: 400 });
  }

  const [updated] = await db
    .update(staff)
    .set(updates)
    .where(and(eq(staff.id, parsed.data.id), eq(staff.restaurantId, restaurant.id)))
    .returning();

  if (!updated) return Response.json({ error: 'Staff not found' }, { status: 404 });

  return Response.json({ staff: updated });
}

export async function DELETE(req: Request) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = sessionStaffDeleteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [deleted] = await db
    .delete(staff)
    .where(and(eq(staff.id, parsed.data.id), eq(staff.restaurantId, restaurant.id)))
    .returning();

  if (!deleted) return Response.json({ error: 'Staff not found' }, { status: 404 });

  return Response.json({ success: true });
}
