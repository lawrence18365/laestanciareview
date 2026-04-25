import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { db } from '@/db';
import { passwordResetTokens, restaurants } from '@/db/schema';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Hash a token with SHA-256 (hex). We never store the raw token in the DB;
 * lookup is by hash so a DB read can't enable replay if the dump leaks.
 */
async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomTokenBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  // base64url
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Issue a single-use password-reset token.
 *
 * Side effect: invalidates any prior unused tokens for this restaurant — only
 * the most recent issuance is honoured. We mark them used (rather than delete)
 * to keep an audit trail.
 *
 * Returns the raw token; the DB only sees its hash.
 */
export async function generateResetToken(slug: string): Promise<string | null> {
  const [restaurant] = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.slug, slug))
    .limit(1);
  if (!restaurant) return null;

  const raw = randomTokenBase64Url();
  const tokenHash = await hashToken(raw);
  const expiresAt = new Date(Date.now() + ONE_HOUR_MS);

  // Invalidate previously issued tokens for this restaurant.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.restaurantId, restaurant.id),
        isNull(passwordResetTokens.usedAt),
      ),
    );

  await db.insert(passwordResetTokens).values({
    restaurantId: restaurant.id,
    tokenHash,
    expiresAt,
  });

  return raw;
}

/**
 * Verify and consume a reset token. Returns the slug if valid, else null.
 * Marks the token used atomically so a concurrent verify cannot replay it.
 */
export async function consumeResetToken(token: string): Promise<string | null> {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const tokenHash = await hashToken(token);
  const now = new Date();

  // Atomic single-use claim: WHERE used_at IS NULL AND expires_at > now()
  const updated = await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .returning({ restaurantId: passwordResetTokens.restaurantId });

  const row = updated[0];
  if (!row) return null;

  const [restaurant] = await db
    .select({ slug: restaurants.slug })
    .from(restaurants)
    .where(eq(restaurants.id, row.restaurantId))
    .limit(1);

  return restaurant?.slug ?? null;
}

/**
 * Best-effort cleanup of expired/used tokens. Safe to call from a cron job.
 */
export async function pruneResetTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(passwordResetTokens)
    .where(
      or(
        lte(passwordResetTokens.expiresAt, new Date()),
        lte(passwordResetTokens.usedAt, cutoff),
      ),
    )
    .returning({ id: passwordResetTokens.id });
  return deleted.length;
}
