'use client';

import { useEffect } from 'react';

export function AuditTracker({
  placeId,
  restaurantName,
  rating,
}: {
  placeId: string;
  restaurantName: string;
  rating: number;
}) {
  useEffect(() => {
    fetch('/api/audit/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placeId, restaurantName, rating: String(rating) }),
      keepalive: true,
    }).catch(() => {});
  }, []);

  return null;
}
