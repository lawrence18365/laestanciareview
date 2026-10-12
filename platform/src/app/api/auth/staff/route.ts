import { db } from '@/db';
import { staff } from '@/db/schema';
import { eq, and, ne, sql } from 'drizzle-orm';
import { verifySession } from '@/lib/session';
import { getRestaurantBySlug, getStaffList } from '@/lib/queries';
import {
  sessionStaffCreateSchema,
  sessionStaffUpdateSchema,
  sessionStaffDeleteSchema,
} from '@/lib/validations';
import { requireSameOrigin } from '@/lib/origin';

const DUPLICATE_CODE_ERROR = 'Ese código ya existe';

/** Store codes without stray whitespace and in a single case. */
function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Find another staff row in the same restaurant already using `code`
 * (case-insensitive, whitespace-tolerant). `exceptId` skips the row being
 * updated so a no-op save never collides with itself.
 */
async function findCodeConflict(restaurantId: number, code: string, exceptId?: number) {
  const filters = [
    eq(staff.restaurantId, restaurantId),
    sql`lower(btrim(${staff.code})) = lower(btrim(${code}))`,
  ];
  if (exceptId !== undefined) filters.push(ne(staff.id, exceptId));

  const [conflict] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(...filters))
    .limit(1);
  return conflict ?? null;
}

/** Postgres unique-violation (SQLSTATE 23505), unwrapping drizzle's error cause. */
function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === '23505') return true;
    if (
      typeof candidate.message === 'string' &&
      /duplicate key value|unique constraint/i.test(candidate.message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

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

  const name = parsed.data.name.trim();
  const code = normalizeCode(parsed.data.code);

  const conflict = await findCodeConflict(restaurant.id, code);
  if (conflict) {
    return Response.json({ error: DUPLICATE_CODE_ERROR }, { status: 409 });
  }

  let created: typeof staff.$inferSelect | undefined;
  try {
    [created] = await db
      .insert(staff)
      .values({
        restaurantId: restaurant.id,
        name,
        code,
      })
      .returning();
  } catch (err) {
    // Two requests can pass the pre-check at the same time; the unique index
    // is the real guard. Surface it as the same 409 JSON, never a raw 500.
    if (isUniqueViolation(err)) {
      return Response.json({ error: DUPLICATE_CODE_ERROR }, { status: 409 });
    }
    throw err;
  }

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
  if (parsed.data.code !== undefined) {
    // Renaming a waiter's code that another waiter already uses would make the
    // QR ambiguous; refuse before touching the row (excluding this waiter).
    const code = normalizeCode(parsed.data.code);
    const conflict = await findCodeConflict(restaurant.id, code, parsed.data.id);
    if (conflict) {
      return Response.json({ error: DUPLICATE_CODE_ERROR }, { status: 409 });
    }
    updates.code = code;
  }
  if (parsed.data.active !== undefined) updates.active = parsed.data.active;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No valid fields' }, { status: 400 });
  }

  let updated: typeof staff.$inferSelect | undefined;
  try {
    [updated] = await db
      .update(staff)
      .set(updates)
      .where(and(eq(staff.id, parsed.data.id), eq(staff.restaurantId, restaurant.id)))
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) {
      return Response.json({ error: DUPLICATE_CODE_ERROR }, { status: 409 });
    }
    throw err;
  }

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
