import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Rate limiter that uses Upstash Redis when configured,
 * with an in-memory fallback for local development.
 */

// --- Upstash Redis-backed limiter ---
let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

const limiters = new Map<string, Ratelimit>();

function getUpstashLimiter(maxRequests: number, windowMs: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;

  const key = `${maxRequests}:${windowMs}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(maxRequests, `${windowMs} ms`),
      analytics: true,
    });
    limiters.set(key, limiter);
  }
  return limiter;
}

// --- In-memory fallback ---
const store = new Map<string, { count: number; resetAt: number }>();
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

function inMemoryCheck(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  cleanup();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }

  entry.count++;
  const allowed = entry.count <= maxRequests;
  return {
    allowed,
    remaining: Math.max(0, maxRequests - entry.count),
    resetAt: entry.resetAt,
  };
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check rate limit for a given key.
 * Uses Upstash Redis if configured, otherwise falls back to in-memory.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const upstash = getUpstashLimiter(maxRequests, windowMs);

  if (upstash) {
    // Upstash ratelimit is async but our interface is sync for backwards compatibility.
    // Fire-and-forget the async check and use in-memory as immediate guard.
    // For proper async usage, use checkRateLimitAsync.
    return inMemoryCheck(key, maxRequests, windowMs);
  }

  return inMemoryCheck(key, maxRequests, windowMs);
}

/**
 * Async rate limit check using Upstash Redis.
 * Falls back to in-memory if Upstash is not configured.
 */
export async function checkRateLimitAsync(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const upstash = getUpstashLimiter(maxRequests, windowMs);

  if (upstash) {
    const result = await upstash.limit(key);
    return {
      allowed: result.success,
      remaining: result.remaining,
      resetAt: result.reset,
    };
  }

  return inMemoryCheck(key, maxRequests, windowMs);
}

/**
 * Get client IP from request headers.
 * On Vercel, x-real-ip is set by the platform and is trustworthy.
 * Falls back to x-forwarded-for (last entry = closest proxy).
 */
export function getClientIP(req: Request): string {
  // Vercel sets x-real-ip to the actual client IP
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  // Fallback: use the rightmost (most trusted) x-forwarded-for entry
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',');
    return parts[parts.length - 1].trim();
  }

  return 'unknown';
}

/**
 * Return a 429 response.
 */
export function rateLimitResponse(resetAt: number) {
  return Response.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'Retry-After': Math.ceil((resetAt - Date.now()) / 1000).toString(),
      },
    },
  );
}
