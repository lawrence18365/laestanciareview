import { describe, expect, it } from 'vitest';
import { classifyLocation, signalLabel } from '@/lib/location-signal';

/**
 * The owner briefing may only report what the numbers show. No summary may
 * claim to know what diners did — we do not measure footfall — and none may
 * comment on whether the manager opened the app.
 */
function expectDescriptive(summary: string) {
  expect(summary).not.toContain('comensales');
  expect(summary).not.toContain('afluencia');
  expect(summary).not.toContain('gerente');
}

// Volume down hard, same eleven waiters asking each week: the floor is intact,
// only the captures per waiter fell.
const traffic = classifyLocation({
  scansThisWeek: 56,
  scansLastWeek: 100,
  staffAskingThisWeek: 11,
  staffAskingLastWeek: 11,
  gmActiveDays: 7,
});

// Volume down and participation collapsed: the one case worth a call.
const adoption = classifyLocation({
  scansThisWeek: 40,
  scansLastWeek: 95,
  staffAskingThisWeek: 5,
  staffAskingLastWeek: 8,
  gmActiveDays: 1,
});

const adoptionGmAbsent = classifyLocation({
  scansThisWeek: 40,
  scansLastWeek: 95,
  staffAskingThisWeek: 5,
  staffAskingLastWeek: 8,
  gmActiveDays: 0,
});

const noTelemetry = classifyLocation({
  scansThisWeek: 40,
  scansLastWeek: 95,
  staffAskingThisWeek: 5,
  staffAskingLastWeek: 8,
  gmActiveDays: 0,
  gmTelemetryAvailable: false,
});

// Nothing this week and nothing last week: the loudest signal there is.
const inactive = classifyLocation({
  scansThisWeek: 0,
  scansLastWeek: 0,
  staffAskingThisWeek: 0,
  staffAskingLastWeek: 0,
  gmActiveDays: 0,
});

// Nothing last week, twelve scans this week: no baseline to compare against.
const noBaseline = classifyLocation({
  scansThisWeek: 12,
  scansLastWeek: 0,
  staffAskingThisWeek: 4,
  staffAskingLastWeek: 0,
  gmActiveDays: 3,
});

const cases = [traffic, adoption, adoptionGmAbsent, noTelemetry, inactive, noBaseline];

describe('classifyLocation — descriptive summaries', () => {
  it('reads held participation as traffic without claiming fewer guests', () => {
    expect(traffic.signal).toBe('traffic');
    expect(traffic.actionable).toBe(false);
    expect(traffic.summary).toContain('Misma participación');
    expect(traffic.summary).not.toContain('comensales');
    expectDescriptive(traffic.summary);
  });

  it('reads collapsed participation as actionable adoption', () => {
    expect(adoption.signal).toBe('adoption');
    expect(adoption.actionable).toBe(true);
    expect(adoption.summary).toContain('Menos meseros participando');
    expectDescriptive(adoption.summary);
  });

  it('reads two empty weeks as inactive and actionable', () => {
    expect(inactive.signal).toBe('inactive');
    expect(inactive.actionable).toBe(true);
    expect(inactive.scanChange).toBeNull();
    expect(inactive.breadthChange).toBeNull();
    expect(inactive.summary).toBe('Sin calificaciones registradas en 14 días.');
    expect(signalLabel(inactive.signal)).toBe('Sin actividad');
    expectDescriptive(inactive.summary);
  });

  it('holds back a conclusion when there is no previous week', () => {
    expect(noBaseline.signal).toBe('insufficient-data');
    expect(noBaseline.actionable).toBe(false);
    expect(noBaseline.scanChange).toBeNull();
    expect(noBaseline.breadthChange).toBeNull();
    expectDescriptive(noBaseline.summary);
  });

  it('never names the manager, whatever the logins say', () => {
    for (const result of cases) {
      expect(result.summary).not.toContain('gerente');
    }
  });

  it('never asserts what diners did in any case', () => {
    for (const result of cases) {
      expect(result.summary).not.toContain('comensales');
      expect(result.summary).not.toContain('afluencia');
    }
  });

  it("labels 'traffic' as menos volumen", () => {
    expect(signalLabel('traffic')).toBe('Menos volumen');
  });
});
