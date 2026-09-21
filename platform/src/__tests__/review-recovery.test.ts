import { describe, expect, it } from 'vitest';
import {
  inboxLinkFor,
  partitionFocused,
  reviewedViaFor,
  statusPatchBody,
} from '@/lib/review-recovery';
import { sessionFeedbackPatchSchema } from '@/lib/validations';

describe('review recovery foundation', () => {
  it('builds inbox links for push and email alerts', () => {
    expect(inboxLinkFor(42)).toBe('/inbox?rid=42');
    expect(inboxLinkFor(42, 'email')).toBe('/inbox?rid=42&src=email');
  });

  it('attributes only a focused push review to its deep link', () => {
    expect(reviewedViaFor({ id: 42, focusReviewId: 42, focusSource: 'push' })).toBe('push_deeplink');
    expect(reviewedViaFor({ id: 42, focusReviewId: 42, focusSource: 'email' })).toBe('inbox');
    expect(reviewedViaFor({ id: 42, focusReviewId: 43, focusSource: 'push' })).toBe('inbox');
  });

  it('pins a known review and leaves the input intact for an unknown one', () => {
    const items = [{ id: 41 }, { id: 42 }, { id: 43 }];
    expect(partitionFocused(items, 42)).toEqual({ pinned: items[1], rest: [items[0], items[2]] });
    expect(partitionFocused(items, 99)).toEqual({ pinned: null, rest: items });
  });

  it('builds complete status patches and rejects an unresolved resolution', () => {
    expect(statusPatchBody({ reviewId: 42, status: 'reviewed', reviewedVia: 'inbox' })).toEqual({
      reviewId: 42,
      status: 'reviewed',
      reviewedVia: 'inbox',
    });
    expect(statusPatchBody({
      reviewId: 42,
      status: 'resolved',
      reviewedVia: 'push_deeplink',
      resolution: 'guest_recovered',
    })).toEqual({
      reviewId: 42,
      status: 'resolved',
      reviewedVia: 'push_deeplink',
      resolution: 'guest_recovered',
    });
    expect(() => statusPatchBody({ reviewId: 42, status: 'resolved', reviewedVia: 'inbox' })).toThrow();
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
