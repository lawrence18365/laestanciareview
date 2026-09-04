import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  getOwnerAccounts: vi.fn(),
  getRegionalAccounts: vi.fn(),
  sendPushToRestaurant: vi.fn(),
}));

vi.mock('@/db', () => {
  function query(rows: unknown[]) {
    const builder: Record<string, unknown> = {};
    for (const method of [
      'from',
      'innerJoin',
      'leftJoin',
      'where',
      'groupBy',
      'orderBy',
      'limit',
    ]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = (
      resolve: (value: unknown[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject);
    return builder;
  }

  return {
    db: {
      select: vi.fn(() => query(mocks.selectRows.shift() ?? [])),
    },
  };
});

vi.mock('@/lib/queries', () => ({
  getOwnerAccounts: mocks.getOwnerAccounts,
  getRegionalAccounts: mocks.getRegionalAccounts,
}));

vi.mock('@/lib/push', () => ({
  sendPushToRestaurant: mocks.sendPushToRestaurant,
}));

import {
  formatLocationAnomaly,
  formatStaffAnomaly,
  getLocationAnomalies,
  getStaffAnomalies,
  runDailyLocationAnomalyCheck,
} from '@/lib/anomalies';

const now = new Date('2026-09-04T16:00:00.000Z');

function locationDayRows(
  restaurantId: number,
  name: string,
  region: string,
  counts: Record<string, number>,
) {
  return Object.entries(counts).map(([reviewDate, reviewCount]) => ({
    restaurantId,
    name,
    region,
    reviewDate,
    reviewCount,
  }));
}

describe('baseline anomaly detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows.length = 0;
    mocks.getOwnerAccounts.mockResolvedValue([]);
    mocks.getRegionalAccounts.mockResolvedValue([]);
    mocks.sendPushToRestaurant.mockResolvedValue({ targeted: 0, sent: 0, failed: 0 });
  });

  it('formats exact factual staff and location sentences', () => {
    expect(formatStaffAnomaly({
      staffId: 1,
      staffName: 'Ana',
      staffCode: 'ANA',
      baselineWeekly: 7.6,
      lastWeekCount: 2,
      dropPct: 0.746,
    })).toBe('Ana recibió 2 respuestas esta semana vs 8 normalmente (-75%).');

    expect(formatLocationAnomaly({
      restaurantId: 3,
      name: 'Centro',
      region: 'centro',
      expected3d: 8.4,
      actual3d: 2,
      dropPct: 0.761,
    })).toBe('Centro: 2 respuestas en 3 días vs 8 normalmente (-76%).');
  });

  it('excludes zero weeks, requires two active weeks and baseline five, and includes a 60 percent drop', async () => {
    mocks.selectRows.push([
      {
        staffId: 1,
        staffName: 'Ana',
        staffCode: 'ANA',
        week1Count: 12,
        week2Count: 0,
        week3Count: 8,
        week4Count: 0,
        lastWeekCount: 4,
      },
      {
        staffId: 2,
        staffName: 'Beto',
        staffCode: 'BETO',
        week1Count: 5,
        week2Count: 5,
        week3Count: 0,
        week4Count: 0,
        lastWeekCount: 2,
      },
      {
        staffId: 3,
        staffName: 'Carla',
        staffCode: 'CARLA',
        week1Count: 20,
        week2Count: 0,
        week3Count: 0,
        week4Count: 0,
        lastWeekCount: 0,
      },
      {
        staffId: 4,
        staffName: 'Diego',
        staffCode: 'DIEGO',
        week1Count: 4,
        week2Count: 4,
        week3Count: 0,
        week4Count: 0,
        lastWeekCount: 0,
      },
      {
        staffId: 5,
        staffName: 'Elena',
        staffCode: 'ELENA',
        week1Count: 10,
        week2Count: 10,
        week3Count: 0,
        week4Count: 0,
        lastWeekCount: 5,
      },
    ]);

    const result = await getStaffAnomalies(7, now);

    expect(result.map((entry) => entry.staffName)).toEqual(['Ana', 'Beto']);
    expect(result[0]).toMatchObject({ baselineWeekly: 10, lastWeekCount: 4 });
    expect(result[0].dropPct).toBeCloseTo(0.6);
    expect(result[1]).toMatchObject({ baselineWeekly: 5, lastWeekCount: 2 });
    expect(result[1].dropPct).toBeCloseTo(0.6);
  });

  it('requires six expected responses and allows actual volume at exactly 25 percent', async () => {
    mocks.selectRows.push([
      ...locationDayRows(1, 'Centro', 'centro', {
        '2026-08-04': 2, '2026-08-05': 2, '2026-08-06': 2,
        '2026-08-11': 2, '2026-08-12': 2, '2026-08-13': 2,
        '2026-08-18': 2, '2026-08-19': 2, '2026-08-20': 2,
        '2026-08-25': 2, '2026-08-26': 2, '2026-08-27': 2,
        '2026-09-01': 1,
      }),
      ...locationDayRows(2, 'Sur', 'sur', {
        '2026-08-04': 4, '2026-08-05': 4, '2026-08-06': 4,
        '2026-08-11': 4, '2026-08-12': 4, '2026-08-13': 4,
        '2026-08-18': 4, '2026-08-19': 4, '2026-08-20': 4,
        '2026-08-25': 4, '2026-08-26': 4, '2026-08-27': 4,
        '2026-09-01': 1, '2026-09-02': 1, '2026-09-03': 1,
      }),
      ...locationDayRows(3, 'Norte', 'norte', {
        '2026-08-04': 2, '2026-08-05': 2, '2026-08-06': 2,
        '2026-08-11': 2, '2026-08-12': 2, '2026-08-13': 2,
        '2026-08-18': 2, '2026-08-19': 2, '2026-08-20': 2,
        '2026-08-25': 2, '2026-08-26': 2,
        '2026-08-27': 1,
      }),
      ...locationDayRows(4, 'Oeste', 'oeste', {
        '2026-08-04': 2, '2026-08-05': 2, '2026-08-06': 2,
        '2026-08-11': 2, '2026-08-12': 2, '2026-08-13': 2,
        '2026-08-18': 2, '2026-08-19': 2, '2026-08-20': 2,
        '2026-08-25': 2, '2026-08-26': 2, '2026-08-27': 2,
        '2026-09-01': 1, '2026-09-02': 1,
      }),
    ]);

    const result = await getLocationAnomalies(now);

    expect(result.map((entry) => entry.name)).toEqual(['Sur', 'Centro']);
    expect(result[0]).toMatchObject({ expected3d: 12, actual3d: 3, dropPct: 0.75 });
    expect(result[1].expected3d).toBe(6);
  });

  it('matches weekday baselines for low weekdays and high weekends', async () => {
    mocks.selectRows.push([
      ...locationDayRows(5, 'Ritmo semanal', 'centro', {
        '2026-08-04': 5, '2026-08-05': 5, '2026-08-06': 5,
        '2026-08-11': 5, '2026-08-12': 5, '2026-08-13': 5,
        '2026-08-18': 5, '2026-08-19': 5, '2026-08-20': 5,
        '2026-08-25': 5, '2026-08-26': 5, '2026-08-27': 5,
        '2026-09-01': 4, '2026-09-02': 4, '2026-09-03': 4,
      }),
    ]);

    await expect(getLocationAnomalies(now)).resolves.toEqual([]);

    mocks.selectRows.push([
      ...locationDayRows(5, 'Ritmo semanal', 'centro', {
        '2026-08-07': 5, '2026-08-08': 80, '2026-08-09': 80,
        '2026-08-14': 5, '2026-08-15': 80, '2026-08-16': 80,
        '2026-08-21': 5, '2026-08-22': 80, '2026-08-23': 80,
        '2026-08-28': 5, '2026-08-29': 80, '2026-08-30': 80,
        '2026-09-04': 4, '2026-09-05': 3, '2026-09-06': 3,
      }),
    ]);

    const weekendResult = await getLocationAnomalies(
      new Date('2026-09-07T16:00:00.000Z'),
    );

    expect(weekendResult).toHaveLength(1);
    expect(weekendResult[0]).toMatchObject({
      name: 'Ritmo semanal',
      expected3d: 165,
      actual3d: 10,
    });
  });

  it('skips recent locations and pushes to owners plus only matching regional accounts', async () => {
    mocks.selectRows.push(
      [
        ...locationDayRows(1, 'Reciente', 'centro', {
          '2026-08-04': 4, '2026-08-05': 4, '2026-08-06': 4,
          '2026-08-11': 4, '2026-08-12': 4, '2026-08-13': 4,
          '2026-08-18': 4, '2026-08-19': 4, '2026-08-20': 4,
          '2026-08-25': 4, '2026-08-26': 4, '2026-08-27': 4,
        }),
        ...locationDayRows(2, 'Centro', 'centro', {
          '2026-08-04': 3, '2026-08-05': 3, '2026-08-06': 3,
          '2026-08-11': 3, '2026-08-12': 3, '2026-08-13': 3,
          '2026-08-18': 3, '2026-08-19': 3, '2026-08-20': 3,
          '2026-08-25': 3, '2026-08-26': 3, '2026-08-27': 3,
          '2026-09-01': 1, '2026-09-02': 1,
        }),
      ],
      [{ id: 44 }],
      [],
    );
    mocks.getOwnerAccounts.mockResolvedValue([
      { id: 90, isOwner: true, isRegional: false, region: null },
    ]);
    mocks.getRegionalAccounts.mockResolvedValue([
      { id: 91, isOwner: false, isRegional: true, region: 'centro' },
      { id: 92, isOwner: false, isRegional: true, region: 'norte' },
    ]);
    mocks.sendPushToRestaurant.mockResolvedValue({ targeted: 2, sent: 1, failed: 1 });

    const result = await runDailyLocationAnomalyCheck(now);

    expect(result).toMatchObject({ pushed: 3, targeted: 6, skippedRecent: 1 });
    expect(result.anomalies).toHaveLength(2);
    expect(mocks.sendPushToRestaurant.mock.calls.map((call) => call[0])).toEqual([2, 90, 91]);
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledWith(
      2,
      {
        title: 'Centro: 2 respuestas en 3 días vs 9 normalmente (-78%).',
        body: 'Revise si las tarjetas están en uso.',
        url: '/dashboard',
        tag: 'location-anomaly-2-2026-09-04',
      },
      { kind: 'location_anomaly', subjectType: 'restaurant', subjectId: 2 },
    );
    expect(mocks.sendPushToRestaurant).toHaveBeenCalledWith(
      91,
      expect.objectContaining({ url: '/overview' }),
      { kind: 'location_anomaly', subjectType: 'restaurant', subjectId: 2 },
    );
  });

  it('contains none of the retired phrases in source files', () => {
    const sourceRoot = join(process.cwd(), 'src');
    const retiredPhrases = [
      ['dejó', 'de', 'pedir'].join(' '),
      ['dejaron', 'de', 'pedir'].join(' '),
      ['quedó', 'callado'].join(' '),
    ];
    const matches: string[] = [];

    function visit(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          visit(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;

        const text = readFileSync(path, 'utf8').toLocaleLowerCase('es-MX');
        if (retiredPhrases.some((phrase) => text.includes(phrase))) {
          matches.push(relative(sourceRoot, path));
        }
      }
    }

    visit(sourceRoot);
    expect(matches).toEqual([]);
  });
});
