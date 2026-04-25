import { verifySession } from '@/lib/session';
import { getRestaurantBySlug } from '@/lib/queries';
import { sendGMFeedback } from '@/lib/email';
import { requireSameOrigin } from '@/lib/origin';

export async function POST(req: Request) {
  const csrf = requireSameOrigin(req);
  if (csrf) return csrf;

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
  const { category, subject, message } = body as {
    category?: string;
    subject?: string;
    message?: string;
  };

  if (
    !message ||
    typeof message !== 'string' ||
    !message.trim() ||
    message.length > 10_000
  ) {
    return Response.json({ error: 'Message is required' }, { status: 400 });
  }
  if (category && (typeof category !== 'string' || category.length > 50)) {
    return Response.json({ error: 'Invalid category' }, { status: 400 });
  }
  if (subject && (typeof subject !== 'string' || subject.length > 200)) {
    return Response.json({ error: 'Invalid subject' }, { status: 400 });
  }

  await sendGMFeedback({
    restaurantName: restaurant.name,
    restaurantSlug: session.slug,
    category: (category as string) || 'feedback',
    subject: (subject as string) || '',
    message: message.trim(),
  });

  return Response.json({ ok: true });
}
