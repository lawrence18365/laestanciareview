export const REVIEWED_VIA = ['inbox', 'push_action', 'push_deeplink'] as const;
export type ReviewedVia = (typeof REVIEWED_VIA)[number];
export const RESOLUTIONS = ['guest_recovered', 'compensation_given', 'guest_already_left', 'could_not_resolve', 'not_an_issue'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const RESOLUTION_LABEL: Record<Resolution, string> = {
  guest_recovered: 'Huésped recuperado',
  compensation_given: 'Se dio compensación',
  guest_already_left: 'El huésped ya se había ido',
  could_not_resolve: 'No se pudo resolver',
  not_an_issue: 'No era un problema',
};

/** Deep link every complaint alert points at. Push tracking (src=push&nid=) is appended by push.ts. */
export function inboxLinkFor(reviewId: number, src?: 'email'): string {
  return src === 'email' ? `/inbox?rid=${reviewId}&src=email` : `/inbox?rid=${reviewId}`;
}

export function reviewedViaFor({
  id,
  focusReviewId,
  focusSource,
}: {
  id: number;
  focusReviewId?: number;
  focusSource?: 'push' | 'email';
}): ReviewedVia {
  return focusSource === 'push' && id === focusReviewId ? 'push_deeplink' : 'inbox';
}

export function partitionFocused<T extends { id: number }>(
  items: T[],
  focusReviewId?: number,
): { pinned: T | null; rest: T[] } {
  const pinned = items.find((item) => item.id === focusReviewId) ?? null;
  return pinned ? { pinned, rest: items.filter((item) => item.id !== pinned.id) } : { pinned: null, rest: items };
}

export function statusPatchBody({
  reviewId,
  status,
  reviewedVia,
  resolution,
}: {
  reviewId: number;
  status: 'reviewed' | 'resolved';
  reviewedVia: ReviewedVia;
  resolution?: Resolution;
}): object {
  if (status === 'resolved' && !resolution) {
    throw new Error('A resolution is required when resolving feedback');
  }

  return status === 'resolved'
    ? { reviewId, status, reviewedVia, resolution }
    : { reviewId, status, reviewedVia };
}
