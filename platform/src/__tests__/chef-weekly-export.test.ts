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

  it('changes completed weeks at Mexico City Monday midnight, not UTC midnight', () => {
    expect(computeWeekWindow(undefined, new Date('2026-10-05T05:59:59Z')).startDate).toBe('2026-09-21');
    expect(computeWeekWindow(undefined, new Date('2026-10-05T06:00:00Z')).startDate).toBe('2026-09-28');
    expect(() => computeWeekWindow('2026-10-05', new Date('2026-10-05T14:00:00Z'))).toThrow(/complete/);
    for (const week of ['2026-09-21', '2026-09-28']) expect(computeWeekWindow(week, new Date('2026-10-05T14:00:00Z')).startDate).toBe(week);
  });

  it('redacts known full staff/customer names with accent variants and retains manual uncertainty', () => {
    const result = redactComment('Jose Ramos dijo gracias a Ana Ruiz, sopa rica', 'Ana Ruiz', null, ['José Ramos']);
    expect(result.text).not.toMatch(/Jose|Ana/);
    expect(result.uncertain).toBe(true);
  });

  it('automatic policy trusts successful known full-name/contact redaction but withholds residual identity', () => {
    const safe = redactComment('La sopa salada, gracias a Jose Ramos; guest@example.test', null, null, ['José Ramos'], true);
    expect(safe.uncertain).toBe(false); expect(safe.text).not.toMatch(/Jose Ramos|guest@example/);
    expect(redactComment('Pregunten a Pedro Perez, sopa salada', null, null, [], true).uncertain).toBe(true);
    expect(redactComment('La sopa salada', null, null, ['La', 'sal', 'Sopa Salazar'], true).text).toBe('La sopa salada');
    const shortened = redactComment('francisco muy atento, la sopa salada', null, null, ['Francisco Ramos'], true);
    expect(shortened.uncertain).toBe(false); expect(shortened.text).not.toContain('francisco');
    expect(redactComment('La hostes (Astrid) nos atendió', null, null, [], true).uncertain).toBe(true);
  });

  it('redacts email, phone, and contact handle patterns', () => {
    const result = redactComment('Escriban a guest@example.test o +52 555 123 4567, @guest_contact', null, null);
    expect(result.text).not.toMatch(/guest@example\.test|555 123 4567|@guest_contact/);
    expect(result.text).toContain('[datos personales omitidos]');
    expect(result.counts).toMatchObject({ email: 1, phone: 1, contact_handle: 1 });
    expect(result.uncertain).toBe(true);
  });
});
