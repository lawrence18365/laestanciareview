import { describe, expect, it } from 'vitest';
import { computeWeekWindow, csvField, redactComment, toCsv } from '../../scripts/chef-weekly-export';

describe('chef weekly export pure safeguards', () => {
  it('defaults to the most recently completed Monday-Sunday week', () => {
    const window = computeWeekWindow(undefined, new Date('2026-09-30T18:00:00.000Z'));
    expect(window).toMatchObject({
      startDate: '2026-09-21',
      endDateExclusive: '2026-09-28',
      startUtc: '2026-09-21T06:00:00.000Z',
      endUtc: '2026-09-28T06:00:00.000Z',
    });
  });

  it('uses Mexico City UTC-6 bounds and accepts a Monday start', () => {
    expect(computeWeekWindow('2026-09-21', new Date('2026-09-30T18:00:00.000Z'))).toMatchObject({
      startUtc: '2026-09-21T06:00:00.000Z',
      endUtc: '2026-09-28T06:00:00.000Z',
    });
  });

  it('rejects non-Monday and future week starts', () => {
    expect(() => computeWeekWindow('2026-09-22', new Date('2026-09-30T18:00:00.000Z'))).toThrow(/Monday/);
    expect(() => computeWeekWindow('2026-10-05', new Date('2026-09-30T18:00:00.000Z'))).toThrow(/future/);
  });

  it('quotes CSV fields, preserves newlines, and neutralizes spreadsheet formulas', () => {
    expect(csvField('=SUM(A1:A2)')).toBe("\"'=SUM(A1:A2)\"");
    expect(csvField('said "yes"\nnext')).toBe('"said ""yes""\nnext"');
    expect(csvField('+1')).toBe("\"'+1\"");
    expect(csvField('-1')).toBe("\"'-1\"");
    expect(csvField('@handle')).toBe("\"'@handle\"");
    const csv = toCsv([{ unidad: 'Unidad', fecha: '2026-09-21T00:00:00-06:00', calificacion: '5', mesero: '', comentario: '=safe', senal_comida: 'sin_señal_detectada' }]);
    expect(csv).toContain('\r\n');
    expect(csv).toContain("'=safe");
  });

  it('redacts email, phone, and contact handle patterns', () => {
    const result = redactComment('Escriban a guest@example.test o +52 555 123 4567, @guest_contact', null, null);
    expect(result.text).not.toMatch(/guest@example\.test|555 123 4567|@guest_contact/);
    expect(result.text).toContain('[datos personales omitidos]');
    expect(result.counts).toMatchObject({ email: 1, phone: 1, contact_handle: 1 });
    expect(result.uncertain).toBe(true);
  });
});
