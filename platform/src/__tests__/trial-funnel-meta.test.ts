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

async function runFunnel(rows: Row[]): Promise<string> {
  state.rows = rows;
  state.queries = [];
  vi.resetModules();
  process.env.DATABASE_URL = 'postgres://test';
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void lines.push(a.join(' ')));
  vi.spyOn(console, 'table').mockImplementation(() => undefined);
  const oldArgv = process.argv;
  process.argv = ['node', 'trial-funnel.ts'];
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

  it('still prints the other two splits, unchanged', async () => {
    const out = await runFunnel([row({ forma: 'team', sucursales: '2-5', calif: 1 })]);
    expect(out).toContain('Por forma (team_mode):');
    expect(out).toContain('Por sucursales (locations_band):');
    expect(out).toContain('Por meta (google_profile.goal):');
  });
});
