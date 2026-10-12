'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Google Places autocomplete for an <input>.
 *
 * Extracted from the /contacto signup form so the dashboard can use the same
 * widget: picking a restaurant from Google is what gives us a Place ID, and a
 * Place ID is enough to send guests straight to that restaurant's review page
 * (see lib/google-review.ts). A name typed by hand gives us nothing.
 *
 * Renders NOTHING when the browser key is missing — no input, no script tag —
 * because without the key there is no autocomplete, and every caller already
 * has (or keeps) its own free-text field to fall back on. The key is read here
 * rather than taken as a prop so a caller can branch on
 * `GOOGLE_PLACES_BROWSER_KEY` and render that fallback itself.
 */

export const GOOGLE_PLACES_BROWSER_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_PLACES_BROWSER_KEY ?? '';

/** Fired by the Maps script's onLoad; also re-fired on focus as a safety net. */
const GMAPS_EVENT = 'gmaps:loaded';

export interface PlaceSelection {
  /** Google Place ID — the value worth storing. */
  placeId: string;
  /** The business name as Google has it. */
  name: string;
  /** Locality / state parsed from the place, when Google returns them. */
  address: { city: string; state: string };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect: (selection: PlaceSelection) => void;
  inputId?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  style?: React.CSSProperties;
}

type AddressComponent = { types: string[]; long_name: string };
type PlaceResult = {
  place_id?: string;
  name?: string;
  address_components?: AddressComponent[];
};
type AutocompleteInstance = {
  addListener: (event: string, cb: () => void) => void;
  getPlace: () => PlaceResult;
};
interface GoogleNamespace {
  maps?: {
    places?: {
      Autocomplete: new (
        input: HTMLInputElement,
        opts: Record<string, unknown>,
      ) => AutocompleteInstance;
    };
  };
}

function googleNamespace(): GoogleNamespace | undefined {
  return (window as unknown as { google?: GoogleNamespace }).google;
}

export default function GooglePlaceSearch({
  value,
  onChange,
  onSelect,
  inputId,
  placeholder,
  required,
  autoComplete = 'off',
  style,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ready = useRef(false);
  // Google keeps the listener for the life of the input, so the callback it
  // calls is held in a ref instead of captured on first render. Written in an
  // effect, never during render.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  const initAutocomplete = useCallback(() => {
    if (ready.current || !inputRef.current) return;
    const g = googleNamespace();
    if (!g?.maps?.places) return;

    const ac = new g.maps.places.Autocomplete(inputRef.current, {
      types: ['establishment'],
      componentRestrictions: { country: 'mx' },
      fields: ['place_id', 'name', 'address_components'],
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      let city = '';
      let state = '';
      for (const comp of place.address_components ?? []) {
        if (comp.types.includes('locality')) city = comp.long_name;
        else if (comp.types.includes('administrative_area_level_1')) state = comp.long_name;
      }
      onSelectRef.current({
        placeId: place.place_id ?? '',
        name: place.name ?? '',
        address: { city, state },
      });
    });
    ready.current = true;
  }, []);

  useEffect(() => {
    // The script may already be loaded by the time this effect runs (a second
    // mount on the same page), or may still be in flight — the usual case.
    if (googleNamespace()?.maps) initAutocomplete();
    const onLoad = () => initAutocomplete();
    window.addEventListener(GMAPS_EVENT, onLoad);
    return () => window.removeEventListener(GMAPS_EVENT, onLoad);
  }, [initAutocomplete]);

  if (!GOOGLE_PLACES_BROWSER_KEY) return null;

  return (
    <>
      <Script
        id="google-places"
        strategy="afterInteractive"
        src={`https://maps.googleapis.com/maps/api/js?key=${GOOGLE_PLACES_BROWSER_KEY}&libraries=places&language=es&region=MX`}
        onLoad={() => window.dispatchEvent(new Event(GMAPS_EVENT))}
      />
      <input
        ref={inputRef}
        id={inputId}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          // Focus is the last moment before the user can type, so it is the
          // safest place to retry attaching if the script arrived late.
          if (!ready.current) initAutocomplete();
        }}
        placeholder={placeholder}
        style={style}
        autoComplete={autoComplete}
      />
    </>
  );
}
