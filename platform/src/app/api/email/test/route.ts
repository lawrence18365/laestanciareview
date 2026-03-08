import { NextRequest } from 'next/server';
import { sendTestEmail } from '@/lib/email';
import { requireAdminKey } from '@/lib/auth';

export async function POST(req: NextRequest) {
  if (!requireAdminKey(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { to?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { to } = body;
  if (!to) {
    return Response.json({ error: 'Email "to" is required' }, { status: 400 });
  }

  const result = await sendTestEmail(to);

  if (!result.success) {
    return Response.json({ error: result.error }, { status: 500 });
  }

  return Response.json({ ok: true, emailId: result.id });
}
