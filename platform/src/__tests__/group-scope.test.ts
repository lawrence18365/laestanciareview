/**
 * Group scoping of every owner/regional view (SQ-186).
 *
 * Self-serve trials have restaurants.group_key = NULL and must never show up
 * in, or alert, an owner/regional account of a group. An owner/regional
 * account whose own group_key is NULL sees nothing. NULL never matches NULL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({
  /** Every `.where()` condition handed to the fake db, in call order. */
  wheres: [] as unknown[],
  /** Rows the next awaited query resolves to. */
  rows: [] as unknown[][],
  selectCalls: 0,
}));

vi.mock('@/db', () => {
  function query() {
    const builder: Record<string, unknown> = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'groupBy', 'orderBy', 'limit']) {
      builder[method] = vi.fn(() => builder);
    }
    builder.where = vi.fn((condition: unknown) => {
      mocks.wheres.push(condition);
      return builder;
    });
    const rows = mocks.rows.shift() ?? [];
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject);
    return builder;
  }
  return {
    db: {
      select: vi.fn(() => {
        mocks.selectCalls++;
        return query();
      }),
    },
  };
});

import {
  accountInGroup,
  groupLocationConditions,
  inGroup,
  sameGroup,
} from '@/lib/group-scope';
import { restaurants } from '@/db/schema';
import { getInterceptedReviews, getOverviewStats } from '@/lib/queries';
import { getGuestSignals, getServiceSignals, getUpcomingBirthdays, getWeeklySignals } from '@/lib/weekly-signal';
import { getGroupShareSummary } from '@/lib/maps-rank-group';

const dialect = new PgDialect();
const render = (condition: unknown) => dialect.sqlToQuery(condition as SQL);

/** True when the rendered scope can only ever match a row of exactly this group. */
function scopedTo(condition: unknown, groupKey: string): boolean {
  const { sql, params } = render(condition);
  return sql.includes('"restaurants"."group_key" = $') && params.includes(groupKey);
}

/** True when the rendered scope is a constant false (matches no row at all). */
function matchesNothing(condition: unknown): boolean {
  const { sql, params } = render(condition);
  return /\bfalse\b/.test(sql) && !sql.includes('"group_key"') && !params.includes('grupo-estancia');
}

beforeEach(() => {
  mocks.wheres.length = 0;
  mocks.rows.length = 0;
  mocks.selectCalls = 0;
});

describe('sameGroup', () => {
  it('matches only two present, equal keys', () => {
    expect(sameGroup('grupo-estancia', 'grupo-estancia')).toBe(true);
    expect(sameGroup('grupo-estancia', 'otro-grupo')).toBe(false);
  });

  it('never lets NULL, undefined or empty match anything, including each other', () => {
    expect(sameGroup(null, null)).toBe(false);
    expect(sameGroup(undefined, undefined)).toBe(false);
    expect(sameGroup(null, undefined)).toBe(false);
    expect(sameGroup('', '')).toBe(false);
    expect(sameGroup(null, 'grupo-estancia')).toBe(false);
    expect(sameGroup('grupo-estancia', null)).toBe(false);
  });
});

describe('SQL scope helpers', () => {
  it('scopes a group key to its own rows, locations only', () => {
    const { sql, params } = render(and(...groupLocationConditions('grupo-estancia')));
    expect(sql).toContain('"restaurants"."is_owner" = $');
    expect(sql).toContain('"restaurants"."is_regional" = $');
    expect(sql).toContain('"restaurants"."group_key" = $');
    expect(params).toEqual([false, false, 'grupo-estancia']);
  });

  it('fails closed: a NULL, undefined or empty viewer key matches no row', () => {
    for (const key of [null, undefined, '']) {
      expect(matchesNothing(inGroup(key))).toBe(true);
      expect(matchesNothing(and(...groupLocationConditions(key)))).toBe(true);
      expect(matchesNothing(accountInGroup(restaurants.id, key))).toBe(true);
    }
  });

  it('scopes account-keyed rows through the viewer group', () => {
    const { sql, params } = render(accountInGroup(restaurants.id, 'grupo-estancia'));
    expect(sql).toContain('select "restaurants"."id" from "restaurants" where "restaurants"."group_key" = $');
    expect(params).toEqual(['grupo-estancia']);
  });
});

describe('owner/regional aggregates are scoped to the viewer group', () => {
  it('overview stats: filter by the viewer group, so NULL-group locations drop out', async () => {
    await getOverviewStats('grupo-estancia');
    expect(scopedTo(mocks.wheres[0], 'grupo-estancia')).toBe(true);
  });

  it('overview stats keep the regional narrowing on top of the group', async () => {
    await getOverviewStats('grupo-estancia', 'leon');
    const { sql, params } = render(mocks.wheres[0]);
    expect(sql).toContain('"restaurants"."group_key" = $');
    expect(sql).toContain('"restaurants"."region" = $');
    expect(params).toEqual([false, false, 'grupo-estancia', 'leon']);
  });

  it('an owner with a NULL group_key gets an empty overview scope', async () => {
    await getOverviewStats(null);
    expect(matchesNothing(mocks.wheres[0])).toBe(true);
  });

  it('intercepted drilldown is group scoped and fails closed', async () => {
    await getInterceptedReviews('grupo-estancia');
    await getInterceptedReviews(null);
    expect(scopedTo(mocks.wheres[0], 'grupo-estancia')).toBe(true);
    expect(matchesNothing(mocks.wheres[1])).toBe(true);
  });

  it('weekly signals, guest, service and birthday numbers are group scoped', async () => {
    const weekStart = new Date('2026-10-05T05:00:00.000Z');
    await getWeeklySignals(weekStart, 'grupo-estancia');
    await getGuestSignals(weekStart, 'grupo-estancia');
    await getServiceSignals(weekStart, new Date('2026-10-12T12:00:00.000Z'), 'grupo-estancia');
    await getUpcomingBirthdays(new Date('2026-10-12T12:00:00.000Z'), 'grupo-estancia');
    expect(mocks.wheres).toHaveLength(4);
    for (const condition of mocks.wheres) {
      expect(scopedTo(and(...(Array.isArray(condition) ? condition : [condition])), 'grupo-estancia')).toBe(true);
    }
  });

  it('weekly signals for an owner with a NULL group_key match no location', async () => {
    const weekStart = new Date('2026-10-05T05:00:00.000Z');
    await expect(getWeeklySignals(weekStart, null)).resolves.toEqual([]);
    expect(matchesNothing(mocks.wheres[0])).toBe(true);
  });

  it('group Maps share for an owner with a NULL group_key is empty and never queries', async () => {
    await expect(getGroupShareSummary(null)).resolves.toEqual([]);
    expect(mocks.selectCalls).toBe(0);
  });

  it('group Maps share only reads the viewer group locations', async () => {
    await getGroupShareSummary('grupo-estancia');
    const locationsWhere = mocks.wheres.at(-1);
    expect(scopedTo(locationsWhere, 'grupo-estancia')).toBe(true);
  });
});
