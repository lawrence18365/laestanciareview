import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BriefingLocation } from '@/lib/email';

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
  scansThisWeek: 0,
  scansLastWeek: 0,
  staffAskingThisWeek: 0,
  staffAskingLastWeek: 0,
  gmActiveDays: 0,
  complaintsThisWeek: 0,
  overdueComplaints: 0,
  currentRating: null,
  baselineRating: null,
  signalSummary: '',
  signalLabel: 'Activo',
  actionable: false,
  ...overrides,
});

const locations = [
  location({ name: 'Centro', scansThisWeek: 5, complaintsThisWeek: 2 }),
  location({ name: 'Norte', scansThisWeek: 0, complaintsThisWeek: 1 }),
];

const send = (groupName?: string) => sendOwnerBriefing({
  to: 'owner@example.com',
  weekStart: new Date('2026-10-05T06:00:00Z'),
  locations,
  dashboardUrl: 'https://app.ratetapmx.com/overview',
  groupName,
});

describe('owner briefing group name', () => {
  beforeEach(() => {
    mocks.sendMail.mockClear();
  });

  it('uses the provided groupName in the subject and the body heading', async () => {
    await send('Grupo Prueba');

    const args = mocks.sendMail.mock.calls[0][0];
    expect(args.subject).toBe('Grupo Prueba · 1 de 2 ubicaciones activas, 3 quejas esta semana');
    expect(args.html).toContain('>Grupo Prueba</h1>');
    expect(args.html).not.toContain('Grupo Estancia');
  });

  it('escapes the groupName in the body heading', async () => {
    await send('Grupo <Prueba> & Hijos');

    const args = mocks.sendMail.mock.calls[0][0];
    expect(args.html).toContain('>Grupo &lt;Prueba&gt; &amp; Hijos</h1>');
  });

  it('falls back to "Tu grupo" when groupName is absent or blank', async () => {
    await send();
    expect(mocks.sendMail.mock.calls[0][0].subject).toBe('Tu grupo · 1 de 2 ubicaciones activas, 3 quejas esta semana');

    await send('   ');
    expect(mocks.sendMail.mock.calls[1][0].subject).toBe('Tu grupo · 1 de 2 ubicaciones activas, 3 quejas esta semana');
    expect(mocks.sendMail.mock.calls[1][0].html).toContain('>Tu grupo</h1>');
  });

  it('keeps today\'s subject text for the existing owner row name', async () => {
    await send('Grupo Estancia');

    expect(mocks.sendMail.mock.calls[0][0].subject).toBe('Grupo Estancia · 1 de 2 ubicaciones activas, 3 quejas esta semana');
  });
});
