'use client';

import Script from 'next/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics-client';

/**
 * Google Places autocomplete for an <input>.
 *
 * Extracted from the /contacto signup form so the dashboard can use the same
 * widget: picking a restaurant from Google is what gives us a Place ID, and a
 * Place ID is enough to send guests straight to that restaurant's review page
 * (see lib/google-review.ts). A name typed by hand gives us nothing.
 *
 * With the browser key it loads the Maps script and attaches Google's own
 * autocomplete. Without it, it falls back to a server-backed search
 * (/api/places/search, which uses the server-side Places key) with the same
 * props and the same `onSelect` contract. The key is read here rather than
 * taken as a prop.
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
  /** Street-level address as Google formats it. Empty when Google omits it. */
  fullAddress: string;
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
  /** City the caller already knows; the server adds it when it retries a search. */
  city?: string;
}

type AddressComponent = { types: string[]; long_name: string };
type PlaceResult = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
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

function BrowserPlaceSearch({
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
      fields: ['place_id', 'name', 'formatted_address', 'address_components'],
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
        fullAddress: place.formatted_address ?? '',
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
      <PlaceSearchStatus status="idle" />
    </>
  );
}

type ServerResult = {
  placeId: string;
  name: string;
  address: string;
  city: string;
  state: string;
};

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '0.35rem 0 0',
  padding: 0,
  border: '1px solid rgba(128, 128, 128, 0.35)',
  background: 'var(--panel-bg, var(--bg-card, #fff))',
  color: 'inherit',
};

const resultButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  minHeight: 44,
  padding: '0.6rem 0.75rem',
  textAlign: 'left',
  background: 'transparent',
  color: 'inherit',
  border: 'none',
  borderTop: '1px solid rgba(128, 128, 128, 0.2)',
  font: 'inherit',
  cursor: 'pointer',
};

export const PLACE_SEARCH_HELPER = 'Solo el nombre, sin dirección';
export const PLACE_SEARCH_EMPTY = 'No lo encontramos. Escribe solo el nombre de tu negocio.';

/** Line under the input: the helper while idle, else what the search is doing. */
export function PlaceSearchStatus({ status }: { status: 'idle' | 'loading' | 'empty' | 'error' }) {
  return (
    <p role="status" style={{ margin: '0.3rem 0 0', fontSize: '0.8rem', opacity: 0.7 }}>
      {status === 'idle' && PLACE_SEARCH_HELPER}
      {status === 'loading' && 'Buscando en Google...'}
      {status === 'empty' && PLACE_SEARCH_EMPTY}
      {status === 'error' && 'No pudimos buscar ahora. Escribe el nombre a mano.'}
    </p>
  );
}

/**
 * Fallback when there is no browser key: the same input, but suggestions come
 * from our own API. Search runs from the input's change handler (not an effect
 * on `value`) so picking a result, which rewrites the value, never re-searches.
 */
function ServerPlaceSearch({
  value,
  onChange,
  onSelect,
  inputId,
  placeholder,
  required,
  autoComplete = 'off',
  style,
  city,
}: Props) {
  const [results, setResults] = useState<ServerResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);

  const cancelPending = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => cancelPending, [cancelPending]);

  function handleChange(next: string) {
    onChange(next);
    cancelPending();
    const q = next.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    timer.current = setTimeout(async () => {
      const ac = new AbortController();
      controller.current = ac;
      try {
        const cityParam = city?.trim() ? `&city=${encodeURIComponent(city.trim().slice(0, 60))}` : '';
        const res = await fetch(`/api/places/search?q=${encodeURIComponent(q)}${cityParam}`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as ServerResult[];
        setResults(data);
        setStatus(data.length ? 'idle' : 'empty');
        if (!data.length) {
          track('place_search_empty', { retried: res.headers.get('x-places-retried') === '1' });
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        console.error('places search failed', err);
        setResults([]);
        setStatus('error');
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  function pick(r: ServerResult) {
    cancelPending();
    setResults([]);
    setStatus('idle');
    onChange(r.name);
    onSelect({
      placeId: r.placeId,
      name: r.name,
      address: { city: r.city, state: r.state },
      fullAddress: r.address,
    });
  }

  return (
    <div>
      <input
        id={inputId}
        required={required}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setResults([]);
        }}
        placeholder={placeholder}
        style={style}
        autoComplete={autoComplete}
      />
      {results.length > 0 && (
        <ul aria-label="Resultados de Google" style={listStyle}>
          {results.map((r, i) => (
            <li key={r.placeId}>
              <button
                type="button"
                onClick={() => pick(r)}
                style={{ ...resultButtonStyle, borderTop: i === 0 ? 'none' : resultButtonStyle.borderTop }}
              >
                <span style={{ display: 'block', fontWeight: 600 }}>{r.name}</span>
                <span style={{ display: 'block', fontSize: '0.8rem', opacity: 0.7 }}>{r.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <PlaceSearchStatus status={status} />
    </div>
  );
}

export default function GooglePlaceSearch(props: Props) {
  return GOOGLE_PLACES_BROWSER_KEY ? <BrowserPlaceSearch {...props} /> : <ServerPlaceSearch {...props} />;
}
