/**
 * The reporting CLI is production measurement infrastructure. `--unit` and
 * `--json` both shipped broken once while the general suite was green, because
 * nothing exercised the CLI surface. These tests cover the pure argument layer
 * always, and additionally invoke the real binary when a database is reachable.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ArgError, parseArgs, startsBeforeT0, pct, confidence,
  INSTRUMENTATION_T0, MIN_SAMPLE, HELP,
} from '../../scripts/funnel-report';

const run = promisify(execFile);
const SCRIPT = path.resolve(__dirname, '../../scripts/funnel-report.ts');
const HAS_DB = existsSync(path.resolve(__dirname, '../../.env.local'));
const cli = (args: string[]) =>
  run('npx', ['tsx', SCRIPT, ...args], { cwd: path.resolve(__dirname, '../..'), timeout: 120_000 });

describe('funnel-report argument parsing', () => {
  const NOW = new Date('2026-09-20T00:00:00.000Z');

  it('defaults the funnel window to instrumentation time zero', () => {
    const a = parseArgs([], NOW);
    expect(a.start).toBe(INSTRUMENTATION_T0);
    expect(a.end).toBe(NOW.toISOString());
    expect(a.historical).toBe(false);
    expect(startsBeforeT0(a.start)).toBe(false);
  });

  it('defaults the historical window to 30 days and starts before time zero', () => {
    const a = parseArgs(['--historical'], NOW);
    expect(a.historical).toBe(true);
    expect(a.start).toBe('2026-08-21T00:00:00.000Z');
    expect(startsBeforeT0(a.start)).toBe(true);
  });

  it('accepts an explicit window and a unit slug', () => {
    const a = parseArgs(
      ['--start', '2026-09-15T00:00:00Z', '--end', '2026-09-16T00:00:00Z', '--unit', 'estancia-leon'],
      NOW,
    );
    expect(a.start).toBe('2026-09-15T00:00:00Z');
    expect(a.end).toBe('2026-09-16T00:00:00Z');
    expect(a.unit).toBe('estancia-leon');
  });

  it('rejects invalid dates, inverted windows, bad slugs and missing values', () => {
    expect(() => parseArgs(['--start', 'yesterday'], NOW)).toThrow(ArgError);
    expect(() => parseArgs(['--end', 'not-a-date'], NOW)).toThrow(/valid ISO-8601/);
    expect(() =>
      parseArgs(['--start', '2026-09-16T00:00:00Z', '--end', '2026-09-15T00:00:00Z'], NOW),
    ).toThrow(/must be after/);
    expect(() => parseArgs(['--unit', 'Estancia Leon'], NOW)).toThrow(/not a valid slug/);
    expect(() => parseArgs(['--unit', "x'; drop table reviews; --"], NOW)).toThrow(/not a valid slug/);
    expect(() => parseArgs(['--unit'], NOW)).toThrow(/requires a value/);
    expect(() => parseArgs(['--start', '--json'], NOW)).toThrow(/requires a value/);
  });

  it('suppresses a rate below the sample floor and never divides by zero', () => {
    expect(pct(0, 0)).toBe('—');
    expect(pct(1, 1)).toBe('n=1*');
    expect(pct(5, MIN_SAMPLE - 1)).toBe(`n=${MIN_SAMPLE - 1}*`);
    expect(pct(15, 30)).toBe('50.0%');
  });

  it('labels confidence by denominator', () => {
    expect(confidence(0)).toBe('sin datos');
    expect(confidence(1)).toBe('muy bajo');
    expect(confidence(50)).toBe('bajo');
    expect(confidence(250)).toBe('medio');
    expect(confidence(5000)).toBe('alto');
  });

  it('has a help text naming time zero', () => {
    expect(HELP).toContain(INSTRUMENTATION_T0);
  });
});

describe.skipIf(!HAS_DB)('funnel-report CLI invocation (needs .env.local)', () => {
  it('--help exits cleanly without touching the database', async () => {
    const { stdout } = await cli(['--help']);
    expect(stdout).toContain('funnel-report');
    expect(stdout).toContain(INSTRUMENTATION_T0);
  });

  it('default run prints the funnel sections', async () => {
    const { stdout } = await cli([]);
    expect(stdout).toContain('FUNNEL REPORT');
    expect(stdout).toContain('RAW COUNTS');
    expect(stdout).toContain('CONVERSION BETWEEN STAGES');
    expect(stdout).toContain('RATING CORRELATION');
    expect(stdout).toContain('NOT RECONSTRUCTABLE HISTORICALLY');
    expect(stdout).toContain('No causal claim is made');
  });

  it('--json emits parseable JSON and nothing else on stdout', async () => {
    const { stdout } = await cli(['--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.mode).toBe('funnel');
    expect(parsed.window.t0).toBe(INSTRUMENTATION_T0);
    expect(parsed.window.startsBeforeT0).toBe(false);
    expect(Array.isArray(parsed.units)).toBe(true);
    expect(parsed.units.length).toBeGreaterThan(1);
    for (const u of parsed.units) {
      for (const k of ['aperturas', 'pantalla', 'bloqueados', 'calificaciones', 'google', 'sessions']) {
        expect(typeof u[k]).toBe('number');
      }
    }
  });

  it('--unit restricts to exactly that unit', async () => {
    const { stdout } = await cli(['--unit', 'estancia-queretaro', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.units).toHaveLength(1);
    expect(parsed.units[0].slug).toBe('estancia-queretaro');
  });

  it('a zero-event unit is still reported, not dropped', async () => {
    const { stdout } = await cli(['--unit', 'regio-norte', '--json']);
    const parsed = JSON.parse(stdout);
    expect(parsed.units).toHaveLength(1);
    expect(parsed.units[0].slug).toBe('regio-norte');
    expect(parsed.units[0].aperturas).toBeGreaterThanOrEqual(0);
  });

  it('a slug that does not exist returns zero units instead of erroring', async () => {
    const { stdout } = await cli(['--unit', 'no-such-restaurant', '--json']);
    expect(JSON.parse(stdout).units).toHaveLength(0);
  });

  it('explicit --start/--end is honoured and a pre-T0 window is flagged', async () => {
    const { stdout } = await cli(['--start', '2026-09-01T00:00:00Z', '--end', '2026-09-14T00:00:00Z']);
    expect(stdout).toContain('WINDOW STARTS BEFORE TIME ZERO');
    const j = await cli(['--start', '2026-09-01T00:00:00Z', '--end', '2026-09-14T00:00:00Z', '--json']);
    const parsed = JSON.parse(j.stdout);
    expect(parsed.window.startsBeforeT0).toBe(true);
  });

  it('--historical never emits the post-instrumentation-only stages', async () => {
    const { stdout } = await cli(['--historical']);
    expect(stdout).toContain('ONLY METRICS THAT COVER THE WHOLE WINDOW');
    expect(stdout).toContain('DID NOT EXIST');
    expect(stdout).not.toContain('Ap→Pant');
    const j = await cli(['--historical', '--json']);
    const parsed = JSON.parse(j.stdout);
    expect(parsed.mode).toBe('historical');
    expect(parsed.units[0]).not.toHaveProperty('pantalla');
    expect(parsed.units[0]).not.toHaveProperty('bloqueados');
  });

  it('invalid arguments exit non-zero with a usable message', async () => {
    await expect(cli(['--start', 'garbage'])).rejects.toMatchObject({ code: 2 });
    await expect(cli(['--unit', 'Bad Slug'])).rejects.toMatchObject({ code: 2 });
    await expect(
      cli(['--start', '2026-09-10T00:00:00Z', '--end', '2026-09-09T00:00:00Z']),
    ).rejects.toMatchObject({ code: 2 });
  });
});
