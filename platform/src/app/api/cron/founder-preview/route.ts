import { NextRequest } from 'next/server';
import { sendMail, FROM } from '@/lib/mailer';

export const dynamic = 'force-dynamic';

/**
 * Sends a rendered email preview to a founder inbox. Not scheduled.
 * Founder laptops cannot reach SMTP, so previews of owner/chef emails go out
 * from production. Recipients are limited to OWNER_NOTIFICATION_EMAIL and the
 * subject must be marked as a preview, so this can never reach a customer.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!secret || secret !== cronSecret) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { to?: string; subject?: string; html?: string } | null;
  const to = body?.to?.trim().toLowerCase() ?? '';
  const subject = body?.subject?.trim() ?? '';
  const html = body?.html ?? '';

  const founders = (process.env.OWNER_NOTIFICATION_EMAIL ?? '')
    .replace(/\\n/g, '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!founders.includes(to)) return Response.json({ error: 'Recipient not allowed' }, { status: 400 });
  if (!/^\[(preview|vista previa)\]/i.test(subject)) {
    return Response.json({ error: 'Subject must start with [Preview] or [Vista previa]' }, { status: 400 });
  }
  if (!html) return Response.json({ error: 'html required' }, { status: 400 });

  const result = await sendMail({ from: FROM, to, subject, html });
  const ok = result.success === true;
  return Response.json({ ok, skipped: result.skipped ?? false }, { status: ok ? 200 : 502 });
}
