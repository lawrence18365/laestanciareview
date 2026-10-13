import { NextRequest } from 'next/server';
import {
  getGroupKeyBySlug,
  getRestaurantBySlug,
  getLeaderboard,
  getWeeklyStats,
  getRecentFeedback,
  getFeedbackCounts,
} from '@/lib/queries';
import { canUse, planFor } from '@/lib/entitlements';
import { verifySession } from '@/lib/session';
import { sameGroup } from '@/lib/group-scope';

export async function GET(req: NextRequest) {
  const session = await verifySession();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const slug = req.nextUrl.searchParams.get('restaurant');
  if (!slug) {
    return Response.json(
      { error: 'Missing ?restaurant= parameter' },
      { status: 400 },
    );
  }

  // Verify the user owns this restaurant (owners can see all)
  if (session.role !== 'owner' && session.slug !== slug) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  // Owners see other locations only inside their own group.
  if (session.role === 'owner' && session.slug !== slug) {
    const viewerGroup = await getGroupKeyBySlug(session.slug);
    if (!sameGroup(viewerGroup, restaurant.groupKey)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // feedback_text is enforced here, server-side: a plan without it gets counts
  // and an empty list, and the comment text / guest contact is never selected.
  const canReadText = canUse(planFor(restaurant), 'feedback_text');
  const [leaderboard, weeklyStats, recentFeedback, feedbackCounts] = await Promise.all([
    getLeaderboard(restaurant.id),
    getWeeklyStats(restaurant.id),
    canReadText ? getRecentFeedback(restaurant.id) : Promise.resolve([]),
    canReadText ? Promise.resolve(null) : getFeedbackCounts(restaurant.id),
  ]);

  return Response.json({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
    },
    leaderboard,
    weeklyStats,
    recentFeedback,
    ...(feedbackCounts ? { feedbackLocked: true, feedbackCounts } : {}),
  });
}
