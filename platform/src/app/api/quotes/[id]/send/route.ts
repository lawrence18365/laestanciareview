/**
 * Generate (or reuse) a shareable public link for a quote and return a WhatsApp
 * deep link the hostess taps to send it to the guest. First send flips a draft
 * to "sent" and stamps sent_at. Re-sending reuses the same token so any link
 * already shared keeps working.
 *
 * We return a wa.me deep link (opened client-side) rather than sending server-
 * side — no Twilio dependency, and the hostess sends from her own WhatsApp.
 */

import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { quotes, restaurants } from '@/db/schema';
import { verifySession } from '@/lib/session';
import { requireSameOrigin } from '@/lib/origin';

export const runtime = 'nodejs';

// Digits-only phone for https://wa.me/<digits>. Mirrors the Twilio formatter's
// MX normalization but returns bare digits (no "whatsapp:+" prefix).
function toWaDigits(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3);
  if (d.length === 10) d = '52' + d;
  return d;
}

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://app.ratetapmx.com')
    .replace(/\\n/g, '')
    .trim()
    .replace(/\/$/, '');
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const session = await verifySession();
  if (!session || session.role !== 'gm') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [restaurant] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, session.slug))
    .limit(1);
  if (!restaurant) return Response.json({ error: 'Not found' }, { status: 404 });

  const { id } = await ctx.params;
  const quoteId = parseInt(id, 10);
  if (isNaN(quoteId)) return Response.json({ error: 'Invalid id' }, { status: 400 });

  // Tenant-scoped fetch — never act on another restaurant's quote.
  const [quote] = await db
    .select()
    .from(quotes)
    .where(and(eq(quotes.id, quoteId), eq(quotes.restaurantId, restaurant.id)))
    .limit(1);
  if (!quote) return Response.json({ error: 'Not found' }, { status: 404 });

  // Reuse an existing token so previously shared links keep resolving.
  const token = quote.publicToken ?? randomBytes(12).toString('hex');

  await db
    .update(quotes)
    .set({
      publicToken: token,
      // Advance draft → sent; never downgrade an accepted/expired quote.
      status: quote.status === 'draft' ? 'sent' : quote.status,
      sentAt: quote.sentAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId));

  const url = `${baseUrl()}/q/${token}`;
  const folio = quote.quoteNumber ?? `Q-${String(quoteId).padStart(4, '0')}`;
  const greeting = quote.clientName ? ` ${quote.clientName}` : '';
  const message = `Hola${greeting} 👋 Aquí está tu cotización ${folio}: ${url}`;
  const waLink = quote.clientPhone
    ? `https://wa.me/${toWaDigits(quote.clientPhone)}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  return Response.json({
    ok: true,
    url,
    waLink,
    token,
    status: quote.status === 'draft' ? 'sent' : quote.status,
  });
}
