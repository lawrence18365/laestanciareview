import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// product-events imports the db client; the lists under test never touch it.
vi.mock('@/db', () => ({ db: {}, transactionDb: {} }));

/**
 * SQ-215: no-printer first step for self-serve restaurants. Full-screen QR
 * first, WhatsApp to the last customers second, printing third. Grupo Estancia
 * (NULL team_mode) and 6+ groups render exactly as before.
 */

import { ReadyView, type StatusResponse } from '../app/bienvenida/BienvenidaClient';
import DashboardView from '@/components/dashboard/DashboardView';
import {
  FullscreenQr,
  QrFullscreenButton,
  acquireWakeLock,
  whatsappCustomersHref,
} from '@/components/dashboard/QrShare';
import { PRODUCT_EVENT_NAMES, PUBLIC_EVENT_NAMES } from '@/lib/product-events';
import { t } from '@/lib/i18n';

const INCENTIVE = /gratis|descuento|premio|regalo|cortes[ií]a|sorteo|promoci|obsequio|bono|cup[oó]n|ganar|2x1/i;

function ready(over: Partial<StatusResponse> = {}): StatusResponse {
  return {
    ready: true,
    slug: 'pizzeria-lupita',
    restaurantName: 'Pizzería Lupita',
    reviewUrl: 'https://app.ratetapmx.com/r/pizzeria-lupita',
    qrDataUrl: 'data:image/png;base64,QR',
    googleConnected: true,
    teamMode: null,
    locationsBand: null,
    googleReviewCount: null,
    googleProfile: null,
    ...over,
  };
}

function html(status: StatusResponse) {
  return renderToStaticMarkup(<ReadyView status={status} trialDays={30} panelHref={null} />).replace(
    /<!-- -->/g,
    '',
  );
}

const solo = { teamMode: 'solo' as const, locationsBand: '1' as const };
const team = { teamMode: 'team' as const, locationsBand: '2-5' as const };
const group = { teamMode: 'team' as const, locationsBand: '6+' as const };

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('/bienvenida self-serve order: fullscreen, WhatsApp, print', () => {
  it.each([
    ['solo', solo],
    ['team', team],
  ])('%s: full-screen QR is first, WhatsApp second, print link third', (_n, mode) => {
    const out = html(ready(mode));
    const show = out.indexOf(t.qrShare.showQr);
    const wa = out.indexOf(t.qrShare.whatsapp);
    const helper = out.indexOf(t.qrShare.whatsappHelper);
    const print = out.indexOf(t.qrShare.printSign);
    expect(show).toBeGreaterThan(-1);
    expect(wa).toBeGreaterThan(show);
    expect(helper).toBeGreaterThan(wa);
    expect(print).toBeGreaterThan(helper);
    // the full-screen action is the one primary (dark, filled) control
    expect(out.match(/background:#1c1917/g)).toHaveLength(1);
    expect(out.slice(0, wa).match(/background:#1c1917/g)).toHaveLength(1);
    // print is a plain link to the existing sign
    expect(out).toContain(`<a href="/qr-codes/letrero"`);
  });

  it('team keeps "Agrega a tus meseros" visible below the three actions; solo has none', () => {
    const teamOut = html(ready(team));
    expect(teamOut.indexOf('Agrega a tus meseros')).toBeGreaterThan(teamOut.indexOf(t.qrShare.printSign));
    expect(teamOut).toContain('href="/staff"');
    expect(html(ready(solo))).not.toContain('Agrega a tus meseros');
  });

  it('keeps helper text within 15 words', () => {
    expect(words(t.qrShare.whatsappHelper)).toBeLessThanOrEqual(15);
    expect(t.qrShare.whatsappHelper).toBe('Envíalo a tus últimos 10 clientes');
  });

  it('the group fixture and legacy (NULL team_mode) are unchanged', () => {
    for (const s of [t.qrShare.showQr, t.qrShare.whatsapp, t.qrShare.whatsappHelper, t.qrShare.printSign]) {
      expect(html(ready(group))).not.toContain(s);
      expect(html(ready())).not.toContain(s);
    }
    const g = html(ready(group));
    expect(g).toContain('Agenda una llamada →');
    expect(g).toContain('Agrega a tus meseros');
    const legacy = html(ready());
    expect(legacy).toContain('Agrega a tus meseros →');
    expect(legacy).toContain('Descargar QR por mesero');
    // a profile alone never changes legacy output
    expect(html(ready({ googleReviewCount: 87 }))).toBe(legacy);
  });

  it('keeps the part above the fold within 30 words for solo and team', () => {
    for (const mode of [solo, team]) {
      const out = html(ready({ ...mode, googleReviewCount: 1234 }));
      const m = out.match(/<h1[^>]*>(.*?)<\/h1><p[^>]*>(.*?)<\/p>/)!;
      expect(words(`${m[1]} ${m[2]}`.replace(/<[^>]+>/g, ' '))).toBeLessThanOrEqual(30);
    }
  });
});

describe('WhatsApp link', () => {
  it('is encoded, carries the /r/{slug} link and the neutral message', () => {
    const out = html(ready(solo));
    const m = out.match(/href="(https:\/\/wa\.me\/\?text=[^"]+)"/);
    expect(m).not.toBeNull();
    const href = m![1];
    expect(href).toBe(whatsappCustomersHref('Pizzería Lupita', 'https://app.ratetapmx.com/r/pizzeria-lupita'));
    // nothing raw: spaces, accents and the URL are percent-encoded
    const query = href.split('text=')[1];
    expect(query).not.toMatch(/[\s¡¿íó:/]/);
    expect(query).toContain(encodeURIComponent('/r/pizzeria-lupita'));
    const decoded = decodeURIComponent(query);
    expect(decoded).toBe(
      '¡Gracias por visitarnos en Pizzería Lupita! ¿Nos dejas tu opinión? https://app.ratetapmx.com/r/pizzeria-lupita',
    );
    expect(decoded).toContain('/r/pizzeria-lupita');
  });

  it('keeps the message short and free of incentive wording', () => {
    const text = t.qrShare.whatsappMessage('Pizzería Lupita', 'https://app.ratetapmx.com/r/pizzeria-lupita');
    expect(words(text)).toBeLessThan(25);
    expect(text).not.toMatch(INCENTIVE);
    expect(text).not.toMatch(/estrella|calific/i);
  });
});

describe('full-screen QR view', () => {
  const view = renderToStaticMarkup(
    <FullscreenQr restaurantName="Pizzería Lupita" qrSrc="data:image/png;base64,QR" onClose={() => undefined} />,
  );

  it('renders the QR, the restaurant name, the neutral line and a close button', () => {
    expect(view).toContain('src="data:image/png;base64,QR"');
    expect(view).toContain('Pizzería Lupita');
    expect(view).toContain('¿Cómo te fue? Escanea y déjanos tu reseña');
    expect(view).toContain('role="dialog"');
    expect(view).toContain('background:#fff');
    expect(view).toMatch(/<button[^>]*>Cerrar<\/button>/);
  });

  it('has no incentive words', () => {
    const text = view.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(INCENTIVE);
  });

  it('is closed until the button is pressed', () => {
    const closed = renderToStaticMarkup(
      <QrFullscreenButton placement="bienvenida" restaurantName="Pizzería Lupita" qrSrc="data:image/png;base64,QR" />,
    );
    expect(closed).toContain(t.qrShare.showQr);
    expect(closed).not.toContain('role="dialog"');
  });
});

describe('screen wake lock', () => {
  it('returns the lock where supported', async () => {
    const lock = { release: async () => undefined };
    const got = await acquireWakeLock({ wakeLock: { request: async () => lock } });
    expect(got).toBe(lock);
  });

  it('swallows a rejected request (battery saver, hidden tab)', async () => {
    const got = await acquireWakeLock({
      wakeLock: { request: async () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    });
    expect(got).toBeNull();
  });

  it('swallows a synchronous throw', async () => {
    const got = await acquireWakeLock({
      wakeLock: {
        request: () => {
          throw new Error('boom');
        },
      },
    });
    expect(got).toBeNull();
  });

  it('is a no-op where the API is missing', async () => {
    expect(await acquireWakeLock({})).toBeNull();
    expect(await acquireWakeLock(undefined)).toBeNull();
  });
});

describe('dashboard empty state', () => {
  const props = {
    stats: { totalReviews: 0, avgRating: 0, googleSends: 0 },
    lastWeekStats: { totalReviews: 0, avgRating: 0, googleSends: 0 },
    leaderboard: [],
    unreadCount: 0,
    unreadLowCount: 0,
    roiStats: {
      totalReviews: 0,
      googleSends: 0,
      firstReviewAt: null,
    } as unknown as React.ComponentProps<typeof DashboardView>['roiStats'],
    monthlyStats: [],
    googleTrend: null,
    googleHistory: [],
    googleRating: null,
    googleReviewCount: null,
    googleReviewsToday: null,
  } satisfies React.ComponentProps<typeof DashboardView>;
  const selfServe = { restaurantName: 'Tacos Ana', qrDataUrl: 'data:image/png;base64,QR' };

  it('team self-serve leads with the full-screen QR and keeps the staff CTA', () => {
    const out = renderToStaticMarkup(<DashboardView {...props} selfServe={selfServe} />);
    expect(out.indexOf(t.qrShare.showQr)).toBeGreaterThan(-1);
    expect(out.indexOf('1. Agrega a tus meseros')).toBeGreaterThan(out.indexOf(t.qrShare.showQr));
    expect(out).toContain('href="/staff"');
  });

  it('NULL team_mode renders exactly as before (no selfServe prop)', () => {
    const out = renderToStaticMarkup(<DashboardView {...props} />);
    expect(out).not.toContain(t.qrShare.showQr);
    expect(out).toContain('1. Agrega a tus meseros');
    expect(out).toContain('2. Descarga sus códigos QR');
    expect(out).toContain('background:var(--text-main);color:#fff');
  });
});

describe('product events', () => {
  it.each(['qr_fullscreen_opened', 'whatsapp_share_clicked'])('%s is a registered, authenticated-only event', (name) => {
    expect((PRODUCT_EVENT_NAMES as readonly string[]).includes(name)).toBe(true);
    expect((PUBLIC_EVENT_NAMES as readonly string[]).includes(name)).toBe(false);
  });
});
