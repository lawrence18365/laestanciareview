import { NextRequest } from 'next/server';
import { getRestaurantBySlug } from '@/lib/queries';
import { generateResetToken } from '@/lib/reset-token';
import { sendPasswordResetEmail } from '@/lib/email';
import { checkRateLimitAsync, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

// 3 requests per 15 minutes per IP
const RESET_LIMIT = 3;
const RESET_WINDOW = 15 * 60_000;

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await checkRateLimitAsync(`reset:${ip}`, RESET_LIMIT, RESET_WINDOW);
  if (!rl.allowed) return rateLimitResponse(rl.resetAt);

  let body: { slug?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { slug } = body;
  if (!slug) {
    return Response.json({ error: 'Slug is required' }, { status: 400 });
  }

  // Always return success to avoid leaking which restaurants exist
  const restaurant = await getRestaurantBySlug(slug);

  if (restaurant?.managerEmail) {
    try {
      const token = await generateResetToken(slug);
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      await sendPasswordResetEmail({
        to: restaurant.managerEmail,
        restaurantName: restaurant.name,
        resetUrl,
      });
    } catch (err) {
      console.error('[reset] Failed to send reset email:', err);
    }
  }

  return Response.json({
    ok: true,
    message: 'Si el restaurante tiene un email registrado, se envio un enlace para restablecer la contraseña.',
  });
}
