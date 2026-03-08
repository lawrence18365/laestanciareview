import { NextRequest } from 'next/server';
import { db } from '@/db';
import { staff } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdminKey, unauthorizedResponse } from '@/lib/auth';
import { updateStaffSchema } from '@/lib/validations';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  if (!requireAdminKey(req)) return unauthorizedResponse();

  const { id } = await ctx.params;
  const staffId = parseInt(id, 10);
  if (isNaN(staffId)) {
    return Response.json({ error: 'Invalid staff ID' }, { status: 400 });
  }

  const body = await req.json();
  const parsed = updateStaffSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [updated] = await db
    .update(staff)
    .set(parsed.data)
    .where(eq(staff.id, staffId))
    .returning();

  if (!updated) {
    return Response.json({ error: 'Staff not found' }, { status: 404 });
  }

  return Response.json({ staff: updated });
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  if (!requireAdminKey(req)) return unauthorizedResponse();

  const { id } = await ctx.params;
  const staffId = parseInt(id, 10);
  if (isNaN(staffId)) {
    return Response.json({ error: 'Invalid staff ID' }, { status: 400 });
  }

  const [deleted] = await db
    .delete(staff)
    .where(eq(staff.id, staffId))
    .returning();

  if (!deleted) {
    return Response.json({ error: 'Staff not found' }, { status: 404 });
  }

  return Response.json({ success: true });
}
