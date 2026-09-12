import { describe, expect, it } from 'vitest';
import { classifyLocation, signalLabel } from '@/lib/location-signal';

/**
 * The owner briefing may only report what the numbers show. No summary may
 * claim to know what diners did — we do not measure footfall.
 */
function expectDescriptive(summary: string) {
  expect(summary).not.toContain('comensales');
  expect(summary).not.toContain('afluencia');
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

const cases = [traffic, adoption, adoptionGmAbsent, noTelemetry];

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
    expect(adoption.summary).toContain('abrió la app 1 día');
    expect(adoption.summary).not.toContain('no entró');
    expectDescriptive(adoption.summary);
  });

  it('says the GM never opened the app when gmActiveDays is 0', () => {
    expect(adoptionGmAbsent.signal).toBe('adoption');
    expect(adoptionGmAbsent.summary).toContain('no abrió la app');
    expectDescriptive(adoptionGmAbsent.summary);
  });

  it('withholds GM commentary when the week predates telemetry', () => {
    expect(noTelemetry.summary).not.toContain('gerente');
    expectDescriptive(noTelemetry.summary);
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
