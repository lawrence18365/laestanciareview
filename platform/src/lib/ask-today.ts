import { and, count, eq, gte } from 'drizzle-orm';
import { db } from '@/db';
import { productEvents } from '@/db/schema';
import { startOfTodayMexico } from '@/lib/mexico-tz';

/**
 * How many times this restaurant tapped "Enviar por WhatsApp" on the current
 * America/Mexico_City day. Seeds the "{n} de 5 hoy" progress on the ask-today
 * card; the browser adds one per tap after that. Never throws: a failed count
 * shows as 0 so the card still renders.
 */
export async function whatsappSharesToday(restaurantId: number, now: Date = new Date()): Promise<number> {
  try {
    const rows = await db
      .select({ n: count() })
      .from(productEvents)
      .where(
        and(
          eq(productEvents.restaurantId, restaurantId),
          eq(productEvents.eventName, 'whatsapp_share_clicked'),
          gte(productEvents.createdAt, startOfTodayMexico(now)),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
