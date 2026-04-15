import { db } from '@/db';
import { restaurants } from '@/db/schema';
import { eq } from 'drizzle-orm';

export function slugify(input: string): string {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
  return normalized || 'restaurant';
}

export async function generateUniqueSlug(businessName: string): Promise<string> {
  const base = slugify(businessName);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  // Fallback: random suffix
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}
