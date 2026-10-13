import { NextRequest } from 'next/server';
import { findLoginCandidates } from '@/lib/queries';
import { generateResetToken } from '@/lib/reset-token';
import { sendPasswordResetEmail } from '@/lib/email';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { requireSameOrigin } from '@/lib/origin';

// 3 requests per 15 minutes per IP
const RESET_LIMIT = 3;
const RESET_WINDOW = 15 * 60_000;

export async function POST(req: NextRequest) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`reset:${ip}`, RESET_LIMIT, RESET_WINDOW);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { identifier?: unknown; slug?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // `slug` is the legacy field, kept during the transition.
  const identifier = body.identifier ?? body.slug;
  if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 100) {
    return Response.json({ error: 'Restaurante o correo requerido' }, { status: 400 });
  }

  // Always return the same success body to avoid leaking which accounts exist.
  const candidates = await findLoginCandidates(identifier);

  for (const restaurant of candidates) {
    if (!restaurant.managerEmail) continue;
    try {
      const token = await generateResetToken(restaurant.slug);
      if (token) {
        const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\\n/g, '').trim();
        const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

        await sendPasswordResetEmail({
          to: restaurant.managerEmail,
          restaurantName: restaurant.name,
          resetUrl,
        });
      }
    } catch (err) {
      console.error('[reset] Failed to send reset email:', err);
    }
  }

  return Response.json({
    ok: true,
    message: 'Si la cuenta existe, te enviamos un correo.',
  });
}
