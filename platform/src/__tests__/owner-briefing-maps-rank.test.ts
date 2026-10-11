import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BriefingLocation } from '@/lib/email';
import type { GroupShareSummary } from '@/lib/maps-rank-group';

const mocks = vi.hoisted(() => ({
  sendMail: vi.fn((_args: { subject: string; html: string }) => Promise.resolve({ success: true })),
}));

vi.mock('@/lib/mailer', () => ({ sendMail: mocks.sendMail }));

import { sendOwnerBriefing } from '@/lib/email';

const location = (overrides: Partial<BriefingLocation>): BriefingLocation => ({
  name: 'Sucursal',
  totalGuests: 0,
  newGuestsThisWeek: 0,
  returningGuests: 0,
  courtesiesThisWeek: 0,
  scansThisWeek: 1,
  scansLastWeek: 1,
  staffAskingThisWeek: 0,
  staffAskingLastWeek: 0,
  gmActiveDays: 3,
  complaintsThisWeek: 0,
  overdueComplaints: 0,
  currentRating: null,
  baselineRating: null,
  signalSummary: '',
  signalLabel: 'Activo',
  actionable: false,
  ...overrides,
});

const locations = [location({ name: 'Centro' })];

const share = (overrides: Partial<GroupShareSummary> = {}): GroupShareSummary => ({
  city: 'Monterrey',
  keyword: 'restaurante centro',
  measured: 9,
  avgTop3: 0,
  pointsAny: 0,
  pointsTwoPlus: 0,
  holders: [],
  prevAvgTop3: null,
  runDate: '2026-10-05',
  prevRunDate: null,
  ...overrides,
});

const render = async (groupShare?: GroupShareSummary[]): Promise<string> => {
  await sendOwnerBriefing({
    to: 'owner@example.com',
    weekStart: new Date('2026-10-05T06:00:00Z'),
    locations,
    dashboardUrl: 'https://app.ratetapmx.com/overview',
    groupName: 'Grupo Prueba',
    groupShare,
  });
  return mocks.sendMail.mock.calls[mocks.sendMail.mock.calls.length - 1][0].html;
};

const TITLE = 'Tu grupo en el top 3 de Google Maps';
const FOOTNOTE = '● = lugares del grupo en el top 3 · 9 puntos por ciudad';
const FILLED = '&#9679;';
const EMPTY = '&#9675;';
const UP = '&#9650;';
const DOWN = '&#9660;';

describe('owner briefing group share section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the title and the short footnote when there is data', async () => {
    const html = await render([share()]);

    expect(html).toContain(TITLE);
    expect(html).toContain(FOOTNOTE);
  });

  it('renders no section when groupShare is absent or empty', async () => {
    expect(await render(undefined)).not.toContain(TITLE);
    expect(await render([])).not.toContain(TITLE);
  });

  it('renders no section when no summary has measured points', async () => {
    const html = await render([share({ measured: 0 })]);

    expect(html).not.toContain(TITLE);
  });

  it('rounds the average to the number of filled dots out of three', async () => {
    const html = await render([share({ avgTop3: 1.6, pointsAny: 4 })]);

    expect(html.split(FILLED).length - 1).toBe(2);
    expect(html.split(EMPTY).length - 1).toBe(1);
    expect(html).toContain('4/9');
  });

  it('shows zero filled dots and the opportunity word when the group is outside the top 3', async () => {
    const html = await render([share()]);

    expect(html.split(FILLED).length - 1).toBe(0);
    expect(html.split(EMPTY).length - 1).toBe(3);
    expect(html).toContain('Oportunidad');
  });

  it('shows the opportunity word in amber when there are no holders', async () => {
    const html = await render([share({ avgTop3: 1, pointsAny: 1 })]);

    expect(html).toContain('<strong style="color: #B45309;">Oportunidad</strong>');
  });

  it('collapses holders of the same brand into one entry with a count', async () => {
    const html = await render([share({
      avgTop3: 2,
      pointsAny: 5,
      holders: [
        { restaurantId: 1, name: 'La Silla Juárez', points: 3 },
        { restaurantId: 2, name: 'La Silla Huexotitla', points: 2 },
      ],
    })]);

    expect(html).toContain('La Silla ×2');
    expect(html).not.toContain('Oportunidad');
  });

  it('shows at most two holders and then the count of the rest', async () => {
    const html = await render([share({
      avgTop3: 2,
      pointsAny: 4,
      holders: [
        { restaurantId: 1, name: 'Uno', points: 4 },
        { restaurantId: 2, name: 'Dos', points: 3 },
        { restaurantId: 3, name: 'Tres', points: 2 },
        { restaurantId: 4, name: 'Cuatro', points: 1 },
      ],
    })]);

    expect(html).toContain('Uno, Dos +2');
    expect(html).not.toContain('Tres');
    expect(html).not.toContain('Cuatro');
  });

  it('shows the trend arrow only when the rounded average changed', async () => {
    const same = await render([share({ avgTop3: 1.4, pointsAny: 1, prevAvgTop3: 0.6 })]);
    expect(same).not.toContain(UP);
    expect(same).not.toContain(DOWN);

    const up = await render([share({ avgTop3: 2, pointsAny: 2, prevAvgTop3: 0.6 })]);
    expect(up).toContain(UP);

    const down = await render([share({ avgTop3: 0, pointsAny: 0, prevAvgTop3: 2 })]);
    expect(down).toContain(DOWN);
  });

  it('groups rows by city, with the city with more rows first', async () => {
    const html = await render([
      share({ city: 'Puebla', keyword: 'cabrito Puebla', avgTop3: 1, pointsAny: 1 }),
      share({ city: 'Monterrey', keyword: 'cabrito Monterrey', avgTop3: 0, pointsAny: 0 }),
      share({ city: 'Monterrey', keyword: 'restaurante de cortes Monterrey', avgTop3: 0, pointsAny: 0 }),
    ]);

    const monterrey = html.indexOf('>Monterrey<');
    const puebla = html.indexOf('>Puebla<');
    expect(monterrey).toBeGreaterThan(-1);
    expect(puebla).toBeGreaterThan(monterrey);
  });

  it('sorts rows within a city by dots, then by points, with zero-dot rows last', async () => {
    const html = await render([
      share({ keyword: 'zero Monterrey', avgTop3: 0, pointsAny: 0 }),
      share({ keyword: 'uno Monterrey', avgTop3: 1, pointsAny: 2 }),
      share({ keyword: 'dos Monterrey', avgTop3: 2, pointsAny: 1 }),
    ]);

    const dos = html.indexOf('>dos<');
    const uno = html.indexOf('>uno<');
    const zero = html.indexOf('>zero<');
    expect(dos).toBeGreaterThan(-1);
    expect(dos).toBeLessThan(uno);
    expect(uno).toBeLessThan(zero);
  });

  it('strips the trailing city from the search label', async () => {
    const html = await render([share({ keyword: 'restaurante centro Monterrey' })]);

    expect(html).toContain('>restaurante centro<');
    expect(html).not.toContain('restaurante centro Monterrey');
  });

  it('keeps the search label when the city is not at its end', async () => {
    const html = await render([share({ keyword: 'Monterrey restaurante centro' })]);

    expect(html).toContain('Monterrey restaurante centro');
  });

  it('never renders the old sentence wording', async () => {
    const html = await render([share({ pointsAny: 3, pointsTwoPlus: 2, avgTop3: 1, prevAvgTop3: 0.4, holders: [{ restaurantId: 1, name: 'Centro', points: 3 }] })]);

    expect(html).not.toContain('al menos 1 de los 3 primeros');
    expect(html).not.toContain('2 o más');
    expect(html).not.toContain('fuera del top 3');
    expect(html).not.toContain('antes');
  });

  it('no longer renders the per-location Maps rows', async () => {
    const html = await render([share({ pointsAny: 1, pointsTwoPlus: 0 })]);

    expect(html).not.toContain('Tu visibilidad en Google Maps');
    expect(html).not.toContain('top 20 en');
    expect(html).not.toContain('top 10 en');
  });

  it('escapes the city, search label and holder names', async () => {
    const html = await render([share({
      city: 'A&B',
      keyword: 'x <b> A&B',
      avgTop3: 1,
      pointsAny: 1,
      holders: [{ restaurantId: 1, name: 'R&S Centro', points: 1 }],
    })]);

    expect(html).toContain('>x &lt;b&gt;<');
    expect(html).toContain('R&amp;S Centro');
    expect(html).toContain('>A&amp;B<');
  });
});
