import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * trial:funnel prints the goal answer as a `meta` column and a "Por meta"
 * split (signups / activadas / pagando). The script runs main() on import, so
 * the Neon client is mocked and the console is captured.
 */

type Row = Record<string, string | number | boolean>;

const row = (over: Row): Row => ({
  slug: 'x', creado: '10-13 09:00', fuente: '-', anuncio: '-', forma: 'solo', sucursales: '1',
  meta: '-', google: true, meseros: 0, calif: 0, pago: '-', estado: 'trial', ...over,
});

const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, string | number | boolean>>, queries: [] as string[] }));

vi.mock('@neondatabase/serverless', () => ({
  neon: () => async (strings: TemplateStringsArray) => {
    const text = strings.join('?');
    state.queries.push(text);
    return text.includes('pending_signups') ? state.rows : [{}];
  },
}));

async function runFunnel(rows: Row[], args: string[] = []): Promise<string> {
  state.rows = rows;
  state.queries = [];
  vi.resetModules();
  process.env.DATABASE_URL = 'postgres://test';
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')));
  vi.spyOn(console, 'table').mockImplementation(() => undefined);
  const oldArgv = process.argv;
  process.argv = ['node', 'trial-funnel.ts', ...args];
  try {
    await import('../../scripts/trial-funnel');
    await vi.waitFor(() => expect(lines.join('\n')).toContain('Info: QR descargado'));
  } finally {
    process.argv = oldArgv;
  }
  return lines.join('\n');
}

afterEach(() => vi.restoreAllMocks());

describe('trial-funnel "Por meta"', () => {
  it('reads google_profile.goal through to_jsonb and prints the split', async () => {
    const out = await runFunnel([
      row({ meta: 'more_reviews', calif: 3, pago: 'authorized' }),
      row({ meta: 'more_reviews' }),
      row({ meta: 'beat_competitor', calif: 1 }),
      row({ meta: '-', estado: 'active' }),
    ]);
    // the SQL reads the goal without touching a column that may not exist
    expect(state.queries.some((q) => q.includes("to_jsonb(r)->'google_profile'->>'goal'") && q.includes('as meta'))).toBe(true);

    const section = out.split('Por meta (google_profile.goal):')[1];
    expect(section).toBeDefined();
    const line = (value: string) =>
      section.split('\n').find((l) => l.trim().startsWith(value))!.trim().split(/\s+/);
    // value, signups, activadas, pagando
    expect(line('more_reviews')).toEqual(['more_reviews', '2', '1', '1']);
    expect(line('beat_competitor')).toEqual(['beat_competitor', '1', '1', '0']);
    expect(line('-')).toEqual(['-', '1', '0', '1']);
  });

  it('tolerates rows with no meta value at all', async () => {
    const withoutMeta = row({});
    delete withoutMeta.meta;
    const out = await runFunnel([withoutMeta, row({ meta: 'customer_feedback', calif: 2 })]);
    const section = out.split('Por meta (google_profile.goal):')[1];
    expect(section).toMatch(/\n\s+-\s+1\s+0\s+0/);
    expect(section).toMatch(/customer_feedback\s+1\s+1\s+0/);
    expect(out).not.toContain('undefined');
  });

  it('counts the no-printer QR events in the QR step', async () => {
    await runFunnel([row({})]);
    const qrQuery = state.queries.find((q) => q.includes("'restaurant_qr_printed'"));
    expect(qrQuery).toBeDefined();
    for (const name of ['qr_fullscreen_opened', 'whatsapp_share_clicked', 'restaurant_qr_shared', 'card_qr_shared']) {
      expect(qrQuery).toContain(`'${name}'`);
    }
  });

  it('still prints the other two splits, unchanged', async () => {
    const out = await runFunnel([row({ forma: 'team', sucursales: '2-5', calif: 1 })]);
    expect(out).toContain('Por forma (team_mode):');
    expect(out).toContain('Por sucursales (locations_band):');
    expect(out).toContain('Por meta (google_profile.goal):');
  });
});

/**
 * Cohort metrics. The Neon client is a mock, so the SQL rules are asserted on
 * the query text (they run in Postgres), and the Funnel lines on the rows the
 * query would return.
 */
describe('trial-funnel cohort metrics', () => {
  const mainQuery = () => state.queries.find((q) => q.includes('pending_signups'))!;
  const normalized = () => mainQuery().replace(/\s+/g, ' ');

  it('volvio compares Mexico-City dates, not UTC dates, so it flips across Mexico midnight', async () => {
    await runFunnel([row({})]);
    const sql = normalized();
    expect(sql).toContain(
      "(e.created_at at time zone 'America/Mexico_City')::date > (r.created_at at time zone 'America/Mexico_City')::date",
    );
    // dias counts distinct Mexico-City dates of the same non-bot events
    expect(sql).toMatch(
      /count\(distinct \(e\.created_at at time zone 'America\/Mexico_City'\)::date\)::int from product_events e where e\.restaurant_id = r\.id and coalesce\(e\.properties->>'bot', ''\) <> 'true'\) as dias/,
    );
    expect(sql).toMatch(
      /exists \(select 1 from product_events e where e\.restaurant_id = r\.id and coalesce\(e\.properties->>'bot', ''\) <> 'true' and \(e\.created_at[\s\S]*?\) as volvio/,
    );
  });

  it('real7d excludes the first 30 minutes and stops at 7 days, calif stays all ratings', async () => {
    await runFunnel([row({})]);
    const sql = normalized();
    expect(sql).toContain(
      "v.created_at > r.created_at + interval '30 minutes' and v.created_at <= r.created_at + interval '7 days') as real7d",
    );
    expect(sql).toContain('(select count(*)::int from reviews v where v.restaurant_id = r.id) as calif');
  });

  it('prints Volvieron otro día and Calificación real (7 días) with trials still in the window', async () => {
    const out = await runFunnel([
      row({ calif: 2, volvio: true, real7d: 2, en_ventana: true }),
      // own-test ratings only: calif > 0 but no real rating
      row({ calif: 1, volvio: true, real7d: 0, en_ventana: false }),
      row({ calif: 0, volvio: false, real7d: 0, en_ventana: true }),
    ]);
    const funnel = out.split('Funnel:')[1].split('\n\n')[0];
    expect(funnel).toMatch(/Primera calificación\s+2\n/);
    expect(funnel).toMatch(/Volvieron otro día\s+2\n/);
    expect(funnel).toMatch(/Calificación real \(7 días\)\s+1\s+\(2 aún en ventana\)/);
    // order: after Primera calificación, before Pagando
    expect(funnel.indexOf('Primera calificación')).toBeLessThan(funnel.indexOf('Volvieron otro día'));
    expect(funnel.indexOf('Calificación real')).toBeLessThan(funnel.indexOf('Pagando'));
  });

  it('tolerates rows without the new columns', async () => {
    const out = await runFunnel([row({ calif: 1 })]);
    expect(out).toMatch(/Volvieron otro día\s+0\n/);
    expect(out).toMatch(/Calificación real \(7 días\)\s+0\s+\(0 aún en ventana\)/);
    expect(out).not.toContain('NaN');
  });

  it('without --split prints one Funnel block', async () => {
    const out = await runFunnel([row({ creado_dia: '2026-10-13' })]);
    expect(out).toContain('Funnel:');
    expect(out).not.toContain('Antes de');
    expect(out).not.toContain('Desde 20');
  });

  it('--split partitions signups by Mexico-City creation date into Antes de / Desde', async () => {
    const out = await runFunnel(
      [
        row({ creado_dia: '2026-10-12', calif: 1, volvio: true, real7d: 1 }),
        row({ creado_dia: '2026-10-13', calif: 1 }),
        row({ creado_dia: '2026-10-13', calif: 0, volvio: true }),
        row({ creado_dia: '2026-10-14', calif: 1, real7d: 3 }),
      ],
      ['--split', '2026-10-13'],
    );
    const [, antesPart, desdePart] = out.split(/Funnel \((?:Antes de|Desde) 2026-10-13\):/);
    const antes = antesPart.split('\n\n')[0];
    const desde = desdePart.split('\n\n')[0];
    expect(out).toContain('Funnel (Antes de 2026-10-13):');
    expect(out).toContain('Funnel (Desde 2026-10-13):');
    expect(antes).toMatch(/Signups\s+1\n/);
    expect(antes).toMatch(/Volvieron otro día\s+1\n/);
    expect(antes).toMatch(/Calificación real \(7 días\)\s+1\s/);
    expect(desde).toMatch(/Signups\s+3\n/);
    expect(desde).toMatch(/Primera calificación\s+2\n/);
    expect(desde).toMatch(/Volvieron otro día\s+1\n/);
    expect(desde).toMatch(/Calificación real \(7 días\)\s+1\s/);
  });

  it('SQL gives each trial its Mexico-City creation date for --split', async () => {
    await runFunnel([row({})], ['--split', '2026-10-13']);
    expect(normalized()).toContain(
      "to_char(r.created_at at time zone 'America/Mexico_City', 'YYYY-MM-DD') as creado_dia",
    );
  });

  it('rejects a malformed --split date', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.rows = [row({})];
    vi.resetModules();
    process.env.DATABASE_URL = 'postgres://test';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'table').mockImplementation(() => undefined);
    const oldArgv = process.argv;
    process.argv = ['node', 'trial-funnel.ts', '--split', '13-10-2026'];
    try {
      await import('../../scripts/trial-funnel');
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(2));
    } finally {
      process.argv = oldArgv;
    }
    expect(err).toHaveBeenCalledWith(expect.stringContaining('--split'));
  });
});
