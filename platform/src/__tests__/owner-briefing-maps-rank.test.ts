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
const FOOTNOTE = 'Medido en 9 puntos por ciudad. Cuenta cuántos de los 3 primeros resultados son del grupo.';

describe('owner briefing group share section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the two-or-more wording when at least 5 points hold two or more top 3 places', async () => {
    const html = await render([share({ pointsAny: 7, pointsTwoPlus: 5 })]);

    expect(html).toContain('Monterrey · restaurante centro: 2 o más de los 3 primeros en 5 de 9 puntos');
  });

  it('renders the at-least-one wording when fewer than 5 points have two or more', async () => {
    const html = await render([share({ pointsAny: 3, pointsTwoPlus: 2 })]);

    expect(html).toContain('al menos 1 de los 3 primeros en 3 de 9 puntos');
    expect(html).not.toContain('2 o más');
  });

  it('renders the outside-top-3 wording when no point holds a top 3 place', async () => {
    const html = await render([share()]);

    expect(html).toContain('Monterrey · restaurante centro: fuera del top 3');
  });

  it('lists at most three holder names, comma-separated', async () => {
    const html = await render([share({
      pointsAny: 4,
      pointsTwoPlus: 1,
      holders: [
        { restaurantId: 1, name: 'Uno', points: 4 },
        { restaurantId: 2, name: 'Dos', points: 3 },
        { restaurantId: 3, name: 'Tres', points: 2 },
        { restaurantId: 4, name: 'Cuatro', points: 1 },
      ],
    })]);

    expect(html).toContain('(Uno, Dos, Tres)');
    expect(html).not.toContain('Cuatro');
  });

  it('shows the previous average when a previous run exists', async () => {
    const html = await render([share({ pointsAny: 1, pointsTwoPlus: 0, avgTop3: 1.4, prevAvgTop3: 0.6, prevRunDate: '2026-09-28' })]);

    expect(html).toContain(' · antes 0.6 de 3');
  });

  it('omits the previous average when there is no previous run', async () => {
    const html = await render([share({ pointsAny: 1, pointsTwoPlus: 0, avgTop3: 1.4, prevAvgTop3: null })]);

    expect(html).not.toContain('antes');
  });

  it('strips the trailing city from the keyword display', async () => {
    const html = await render([share({ keyword: 'restaurante centro Monterrey' })]);

    expect(html).toContain('Monterrey · restaurante centro: fuera del top 3');
    expect(html).not.toContain('restaurante centro Monterrey');
  });

  it('keeps the keyword when the city is not at its end', async () => {
    const html = await render([share({ keyword: 'Monterrey restaurante centro' })]);

    expect(html).toContain('Monterrey · Monterrey restaurante centro: fuera del top 3');
  });

  it('renders the title and footnote when there is data', async () => {
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

  it('no longer renders the per-location Maps rows', async () => {
    const html = await render([share({ pointsAny: 1, pointsTwoPlus: 0 })]);

    expect(html).not.toContain('Tu visibilidad en Google Maps');
    expect(html).not.toContain('top 20 en');
    expect(html).not.toContain('top 10 en');
  });

  it('escapes the city and keyword', async () => {
    const html = await render([share({ city: 'A&B', keyword: 'x <b>' })]);

    expect(html).toContain('A&amp;B · x &lt;b&gt;');
  });
});
