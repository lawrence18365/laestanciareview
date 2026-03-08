import { NextRequest } from 'next/server';
import {
  getRestaurantBySlug,
  getLeaderboard,
  getWeeklyStats,
  getRecentFeedback,
} from '@/lib/queries';

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('restaurant');
  if (!slug) {
    return Response.json(
      { error: 'Missing ?restaurant= parameter' },
      { status: 400 },
    );
  }

  const restaurant = await getRestaurantBySlug(slug);
  if (!restaurant) {
    return Response.json({ error: 'Restaurant not found' }, { status: 404 });
  }

  const [leaderboard, weeklyStats, recentFeedback] = await Promise.all([
    getLeaderboard(restaurant.id),
    getWeeklyStats(restaurant.id),
    getRecentFeedback(restaurant.id),
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
  });
}
