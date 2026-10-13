'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics-client';

/**
 * Records `restaurant_qr_printed` when the browser opens its print dialog, by
 * any route (the button, Ctrl+P, the menu). Renders nothing.
 */
export default function PrintTracker() {
  useEffect(() => {
    const onBeforePrint = () => track('restaurant_qr_printed');
    window.addEventListener('beforeprint', onBeforePrint);
    return () => window.removeEventListener('beforeprint', onBeforePrint);
  }, []);
  return null;
}
