import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  getRestaurantBySlug: vi.fn(),
  getStaffList: vi.fn(),
}));

class NavSignal extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

vi.mock('@/db', () => ({ db: {}, transactionDb: {} }));
vi.mock('@/lib/session', () => ({ verifySession: mocks.verifySession }));
vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: mocks.getRestaurantBySlug,
  getStaffList: mocks.getStaffList,
}));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new NavSignal(to);
  },
  notFound: () => {
    throw new NavSignal('notFound');
  },
}));

import QrCodesPage from '../app/(app)/qr-codes/page';
import LetreroPage from '../app/(print)/qr-codes/letrero/page';
import CardQrPrintPage from '../app/(print)/qr-codes/print/page';
import { generateQrSvg } from '@/lib/qr';
import { PRODUCT_EVENT_NAMES, PUBLIC_EVENT_NAMES } from '@/lib/product-events';

function restaurant(teamMode: string | null) {
  return {
    id: 7,
    slug: 'taqueria-lupita',
    name: 'Taquería Lupita',
    logoHash: null,
    teamMode,
  };
}

const manager = { slug: 'taqueria-lupita', role: 'gm' as const };
const staffRows = [
  { id: 1, name: 'Ana Meseros', code: 'ANA1', active: true },
  { id: 2, name: 'Beto Meseros', code: 'BET2', active: true },
];

async function renderQrCodes(teamMode: string | null, staff = staffRows) {
  mocks.verifySession.mockResolvedValue(manager);
  mocks.getRestaurantBySlug.mockResolvedValue(restaurant(teamMode));
  mocks.getStaffList.mockResolvedValue(staff);
  return renderToStaticMarkup(await QrCodesPage());
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('/qr-codes restaurant QR card', () => {
  it.each([[null], ['team'], ['solo']])('shows the restaurant card and its three actions for team_mode=%s', async (mode) => {
    const html = await renderQrCodes(mode);
    expect(html).toContain('Taquería Lupita');
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('href="/qr-codes/letrero"');
    expect(html).toContain('Imprimir letrero');
    expect(html).toContain('Descargar PNG');
    expect(html).toContain('Compartir por WhatsApp');
  });

  it.each([['solo'], ['team']])('team_mode=%s offers the full-screen QR first; NULL does not', async (mode) => {
    const html = await renderQrCodes(mode);
    expect(html).toContain('Mostrar QR en pantalla');
    expect(html.indexOf('Mostrar QR en pantalla')).toBeLessThan(html.indexOf('Imprimir letrero'));
    expect(await renderQrCodes(null)).not.toContain('Mostrar QR en pantalla');
  });

  it('NULL team_mode keeps the waiter grid exactly as before, below the new card', async () => {
    const html = await renderQrCodes(null);
    expect(html).toContain('Ana Meseros');
    expect(html).toContain('Beto Meseros');
    expect(html).toContain('Imprimir todos');
    expect(html).toContain('Cada mesero guarda su código');
    expect(html.indexOf('Imprimir letrero')).toBeLessThan(html.indexOf('Ana Meseros'));
  });

  it('NULL team_mode with no waiters keeps the legacy empty state', async () => {
    const html = await renderQrCodes(null, []);
    expect(html).toContain('Agrega meseros en');
    expect(html).toContain('Imprimir todos');
  });

  it('team keeps the waiter grid', async () => {
    const html = await renderQrCodes('team');
    expect(html).toContain('Ana Meseros');
    expect(html).toContain('Imprimir todos');
  });

  it('solo drops the waiter grid, its empty state and print-all, and points to Personal', async () => {
    for (const staff of [staffRows, []]) {
      const html = await renderQrCodes('solo', staff);
      expect(html).not.toContain('Ana Meseros');
      expect(html).not.toContain('Agrega meseros en');
      expect(html).not.toContain('Imprimir todos');
      expect(html).not.toContain('Cada mesero guarda su código');
      expect(html).toContain('href="/staff"');
      expect(html).toContain('Personal');
    }
  });

  it('sends owners and regionals away, as before', async () => {
    mocks.verifySession.mockResolvedValue({ slug: 'owner', role: 'owner' });
    await expect(QrCodesPage()).rejects.toMatchObject({ to: '/overview' });
  });
});

/** Visible text of the printed sign, without the toolbar. */
function signText(html: string): string {
  const sheet = html.slice(html.indexOf('class="lt-sheet"'));
  return sheet
    .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

describe('/qr-codes/letrero', () => {
  it('renders the name, logo and the QR for the session restaurant', async () => {
    mocks.verifySession.mockResolvedValue(manager);
    mocks.getRestaurantBySlug.mockResolvedValue(restaurant(null));
    const html = renderToStaticMarkup(await LetreroPage());

    expect(mocks.getRestaurantBySlug).toHaveBeenCalledWith('taqueria-lupita');
    expect(html).toContain('Taquería Lupita');
    expect(html).toContain('<img');
    expect(html).toContain(await generateQrSvg('taqueria-lupita'));
    expect(html).toContain('¿Cómo te fue? Déjanos tu reseña en Google');
    expect(html).toContain('Escanea con tu cámara');
    expect(html).toContain('size: letter');
  });

  it('refuses everyone but a logged-in restaurant account', async () => {
    mocks.verifySession.mockResolvedValue(null);
    await expect(LetreroPage()).rejects.toMatchObject({ to: '/login' });

    mocks.verifySession.mockResolvedValue({ slug: 'owner', role: 'owner' });
    await expect(LetreroPage()).rejects.toMatchObject({ to: '/overview' });

    mocks.verifySession.mockResolvedValue({ slug: 'regional-central', role: 'regional' });
    await expect(LetreroPage()).rejects.toMatchObject({ to: '/overview' });

    mocks.verifySession.mockResolvedValue({ slug: 'ghost', role: 'gm' });
    mocks.getRestaurantBySlug.mockResolvedValue(null);
    await expect(LetreroPage()).rejects.toMatchObject({ to: '/login' });
  });

  it('only ever prints the session slug, never another restaurant', async () => {
    mocks.verifySession.mockResolvedValue({ slug: 'other-place', role: 'gm' });
    mocks.getRestaurantBySlug.mockImplementation(async (slug: string) =>
      slug === 'other-place'
        ? { ...restaurant(null), slug: 'other-place', name: 'Otro Lugar' }
        : restaurant(null),
    );
    const html = renderToStaticMarkup(await LetreroPage());
    expect(html).toContain('Otro Lugar');
    expect(html).not.toContain('Taquería Lupita');
    expect(html).toContain(await generateQrSvg('other-place'));
    expect(html).not.toContain(await generateQrSvg('taqueria-lupita'));
  });

  it('keeps the sign to 15 words besides the name, with no incentive wording', async () => {
    mocks.verifySession.mockResolvedValue(manager);
    mocks.getRestaurantBySlug.mockResolvedValue(restaurant(null));
    const text = signText(renderToStaticMarkup(await LetreroPage()));
    const withoutName = text.replace('Taquería Lupita', '').trim();
    expect(withoutName.split(' ').filter(Boolean).length).toBeLessThanOrEqual(15);
    expect(withoutName.toLowerCase()).not.toMatch(
      /gratis|descuento|premio|regalo|cortes[ií]a|sorteo|promoci|obsequio|bono/,
    );
  });
});

describe('/qr-codes/print with no waiters', () => {
  it('links to the letrero instead of "No hay meseros activos."', async () => {
    mocks.verifySession.mockResolvedValue(manager);
    mocks.getRestaurantBySlug.mockResolvedValue(restaurant(null));
    mocks.getStaffList.mockResolvedValue([]);
    const html = renderToStaticMarkup(
      await CardQrPrintPage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).toContain('href="/qr-codes/letrero"');
    expect(html).not.toContain('No hay meseros activos.');
  });
});

describe('restaurant QR product events', () => {
  const names = ['restaurant_qr_printed', 'restaurant_qr_downloaded', 'restaurant_qr_shared'] as const;

  it('are registered, authenticated-only event names', () => {
    for (const name of names) {
      expect(PRODUCT_EVENT_NAMES).toContain(name);
      expect(PUBLIC_EVENT_NAMES).not.toContain(name);
    }
  });

  it('are fired by the surfaces that do the action', () => {
    const root = path.resolve(__dirname, '..');
    const grid = readFileSync(path.join(root, 'components/dashboard/CardQrGrid.tsx'), 'utf8');
    const tracker = readFileSync(
      path.join(root, 'app/(print)/qr-codes/letrero/PrintTracker.tsx'),
      'utf8',
    );
    expect(grid).toContain("track('restaurant_qr_downloaded')");
    expect(grid).toContain("track('restaurant_qr_shared')");
    expect(tracker).toContain("track('restaurant_qr_printed')");
    expect(tracker).toContain("'beforeprint'");
  });
});
