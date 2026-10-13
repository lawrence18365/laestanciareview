'use client';

import { useEffect } from 'react';
import { markGroupDevice } from './mark-group-device';

/** Renders nothing; asks the server to mark this device as a known group device. */
export default function GroupDeviceMarker() {
  useEffect(() => {
    markGroupDevice().catch(() => {
      // best effort: the device just keeps the text field
    });
  }, []);
  return null;
}
