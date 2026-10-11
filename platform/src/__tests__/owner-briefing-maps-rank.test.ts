import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BriefingLocation, MapsRankLocation } from '@/lib/email';
import type { KeywordSummary } from '@/lib/maps-rank';

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

const summary = (overrides: Partial<KeywordSummary>): KeywordSummary => ({
  keyword: 'restaurante centro',
  measured: 9,
  top3: 0,
  top10: 0,
  found: 0,
  bestRank: null,
  prevTop3: null,
  runDate: '2026-10-05',
  prevRunDate: null,
  ...overrides,
});

const render = async (mapsRank?: MapsRankLocation[]): Promise<string> => {
  await sendOwnerBriefing({
    to: 'owner@example.com',
    weekStart: new Date('2026-10-05T06:00:00Z'),
    locations,
    dashboardUrl: 'https://app.ratetapmx.com/overview',
    groupName: 'Grupo Prueba',
    mapsRank,
  });
  return mocks.sendMail.mock.calls[mocks.sendMail.mock.calls.length - 1][0].html;
};

const SECTION = 'Tu visibilidad en Google Maps';
const FOOTNOTE = 'Medido en 9 puntos alrededor de cada sucursal. Google puede ordenar distinto para cada persona.';

describe('owner briefing maps rank section', () => {
  beforeEach(() => {
    mocks.sendMail.mockClear();
  });

  it('renders the top 3 band with the previous count when present', async () => {
    const html = await render([{
      locationName: 'Centro',
      summaries: [summary({ top3: 4, top10: 6, found: 8, prevTop3: 2 })],
    }]);

    expect(html).toContain(SECTION);
    expect(html).toContain('restaurante centro: top 3 en 4 de 9 puntos (antes 2)');
    expect(html).toContain(FOOTNOTE);
  });

  it('omits the previous count when prevTop3 is null', async () => {
    const html = await render([{
      locationName: 'Centro',
      summaries: [summary({ top3: 4, top10: 6, found: 8, prevTop3: null })],
    }]);

    expect(html).toContain('restaurante centro: top 3 en 4 de 9 puntos</td>');
    expect(html).not.toContain('(antes');
  });

  it('renders the top 10 band when no point is in the top 3', async () => {
    const html = await render([{
      locationName: 'Centro',
      summaries: [summary({ top3: 0, top10: 3, found: 5, prevTop3: 1 })],
    }]);

    expect(html).toContain('restaurante centro: top 10 en 3 de 9 puntos');
    expect(html).not.toContain('(antes');
  });

  it('renders the not-found text when no point appears in the top 20', async () => {
    const html = await render([{
      locationName: 'Centro',
      summaries: [summary({ found: 0 })],
    }]);

    expect(html).toContain('restaurante centro: no aparece en los primeros 20');
  });

  it('never prints an exact rank number', async () => {
    const html = await render([{
      locationName: 'Centro',
      summaries: [summary({ top3: 1, top10: 2, found: 3, bestRank: 4 })],
    }]);

    expect(html).not.toContain('#4');
    expect(html).not.toMatch(/posición\s+\d/i);
  });

  it('renders nothing when mapsRank is absent', async () => {
    const html = await render(undefined);

    expect(html).not.toContain(SECTION);
    expect(html).not.toContain(FOOTNOTE);
  });

  it('renders nothing when every summaries array is empty', async () => {
    const html = await render([
      { locationName: 'Centro', summaries: [] },
      { locationName: 'Norte', summaries: [] },
    ]);

    expect(html).not.toContain(SECTION);
  });

  it('escapes the location name and keyword', async () => {
    const html = await render([{
      locationName: 'Centro <Norte>',
      summaries: [summary({ keyword: 'tacos & más', found: 0 })],
    }]);

    expect(html).toContain('Centro &lt;Norte&gt;');
    expect(html).toContain('tacos &amp; más: no aparece en los primeros 20');
  });
});
