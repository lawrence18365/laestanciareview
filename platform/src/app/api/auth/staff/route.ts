import { db } from '@/db';
import { staff } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug, getStaffList } from '@/lib/queries';

export async function GET() {
  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  const list = await getStaffList(restaurant.id);
  return Response.json({ staff: list });
}

export async function POST(req: Request) {
  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { name, code } = body;

  if (!name || typeof name !== 'string' || !code || typeof code !== 'string') {
    return Response.json({ error: 'Name and code are required' }, { status: 400 });
  }

  const [created] = await db
    .insert(staff)
    .values({ restaurantId: restaurant.id, name: name.trim(), code: code.trim() })
    .returning();

  return Response.json({ staff: created }, { status: 201 });
}

export async function PATCH(req: Request) {
  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  let patchBody: Record<string, unknown>;
  try {
    patchBody = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { id, name, code, active } = patchBody;

  if (!id || typeof id !== 'number') {
    return Response.json({ error: 'Staff ID required' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof name === 'string' && name.trim()) updates.name = name.trim();
  if (typeof code === 'string' && code.trim()) updates.code = code.trim();
  if (typeof active === 'boolean') updates.active = active;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields' }, { status: 400 });
  }

  const [updated] = await db
    .update(staff)
    .set(updates)
    .where(and(eq(staff.id, id), eq(staff.restaurantId, restaurant.id)))
    .returning();

  if (!updated) return Response.json({ error: 'Staff not found' }, { status: 404 });

  return Response.json({ staff: updated });
}

export async function DELETE(req: Request) {
  const session = await verifySession();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const restaurant = await getRestaurantBySlug(session.slug);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  let delBody: Record<string, unknown>;
  try {
    delBody = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { id: deleteId } = delBody;

  if (!deleteId || typeof deleteId !== 'number') {
    return Response.json({ error: 'Staff ID required' }, { status: 400 });
  }

  const [deleted] = await db
    .delete(staff)
    .where(and(eq(staff.id, deleteId), eq(staff.restaurantId, restaurant.id)))
    .returning();

  if (!deleted) return Response.json({ error: 'Staff not found' }, { status: 404 });

  return Response.json({ success: true });
}
