import { describe, expect, it } from 'vitest';
import { inboxLinkFor } from '@/lib/review-recovery';
import { sessionFeedbackPatchSchema } from '@/lib/validations';

describe('review recovery foundation', () => {
  it('builds inbox links for push and email alerts', () => {
    expect(inboxLinkFor(42)).toBe('/inbox?rid=42');
    expect(inboxLinkFor(42, 'email')).toBe('/inbox?rid=42&src=email');
  });

  it('requires a known resolution when resolving feedback', () => {
    expect(sessionFeedbackPatchSchema.safeParse({ reviewId: 42, status: 'resolved' }).success).toBe(false);
    expect(sessionFeedbackPatchSchema.safeParse({
      reviewId: 42,
      status: 'resolved',
      resolution: 'guest_recovered',
    }).success).toBe(true);
  });

  it('rejects unknown reviewed-via and resolution values', () => {
    expect(sessionFeedbackPatchSchema.safeParse({
      reviewId: 42,
      status: 'reviewed',
      reviewedVia: 'carrier_pigeon',
    }).success).toBe(false);
    expect(sessionFeedbackPatchSchema.safeParse({
      reviewId: 42,
      status: 'resolved',
      resolution: 'other',
    }).success).toBe(false);
  });
});
