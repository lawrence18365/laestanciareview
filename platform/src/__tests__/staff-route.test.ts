import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const state = {
    /** Rows the next `select().from().where().limit()` resolves to. */
    selectRows: [] as Array<{ id: number }>,
    selectConditions: [] as unknown[],
    insertedValues: [] as Array<Record<string, unknown>>,
    updatedSets: [] as Array<Record<string, unknown>>,
    updateReturning: [] as Array<Record<string, unknown>>,
    insertError: null as unknown,
    updateError: null as unknown,
  };

  const database = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((condition: unknown) => {
          state.selectConditions.push(condition);
          return { limit: vi.fn(async () => state.selectRows) };
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        state.insertedValues.push(values);
        return {
          returning: vi.fn(async () => {
            if (state.insertError) throw state.insertError;
            return [{ id: 1, active: true, ...values }];
          }),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        state.updatedSets.push(values);
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => {
              if (state.updateError) throw state.updateError;
              return state.updateReturning;
            }),
          })),
        };
      }),
    })),
  };

  /**
   * Flatten a drizzle SQL tree into the literal SQL text. `sql` templates are
   * wrapped in StringChunk objects, columns are objects with a name, and `and()`
   * nests SQL nodes; interpolated plain strings sit inline in the text.
   */
  function sqlText(node: unknown, depth = 0): string {
    if (depth > 10 || node == null) return '';
    if (typeof node === 'string') return node;
    if (typeof node !== 'object') return '';

    const ctor = (node as { constructor?: { name?: string } }).constructor?.name ?? '';
    const value = (node as { value?: unknown }).value;
    if (ctor === 'StringChunk') {
      return Array.isArray(value) ? value.join('') : String(value ?? '');
    }
    if (ctor === 'Param') return '';

    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) return '';
    return chunks.map((chunk) => sqlText(chunk, depth + 1)).join('');
  }

  return { state, database, sqlText };
});

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(async () => ({ slug: 'demo', role: 'gm' })),
}));
vi.mock('@/lib/queries', () => ({
  getRestaurantBySlug: vi.fn(async () => ({ id: 5, slug: 'demo' })),
  getStaffList: vi.fn(async () => []),
}));
vi.mock('@/lib/origin', () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock('@/db', () => ({ db: mocks.database }));

import { PATCH, POST } from '@/app/api/auth/staff/route';

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request('https://app.ratetapmx.com/api/auth/staff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function uniqueViolation(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "staff_restaurant_code_uniq"'),
    { code: '23505' },
  );
}

describe('staff route code handling', () => {
  beforeEach(() => {
    mocks.state.selectRows = [];
    mocks.state.selectConditions.length = 0;
    mocks.state.insertedValues.length = 0;
    mocks.state.updatedSets.length = 0;
    mocks.state.updateReturning = [];
    mocks.state.insertError = null;
    mocks.state.updateError = null;
  });

  describe('POST', () => {
    it('uppercases and trims the code before insert', async () => {
      const response = await POST(jsonRequest({ name: '  Juan Pérez ', code: '  juan ' }));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.staff.code).toBe('JUAN');
      expect(body.staff.name).toBe('Juan Pérez');
      expect(mocks.state.insertedValues[0]).toEqual(
        expect.objectContaining({ code: 'JUAN', name: 'Juan Pérez', restaurantId: 5 }),
      );
    });

    it('returns 409 JSON when the pre-check finds the code', async () => {
      mocks.state.selectRows = [{ id: 9 }];

      const response = await POST(jsonRequest({ name: 'Juan', code: 'ana' }));
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe('Ese código ya existe');
      expect(mocks.state.insertedValues).toHaveLength(0);
      expect(mocks.sqlText(mocks.state.selectConditions[0])).toContain('lower(');
    });

    it('returns 409 JSON when the unique index rejects the insert', async () => {
      mocks.state.insertError = uniqueViolation();

      const response = await POST(jsonRequest({ name: 'Juan', code: 'JUAN' }));
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe('Ese código ya existe');
    });

    it('recognises a unique violation without a SQLSTATE code', async () => {
      mocks.state.insertError = new Error(
        'duplicate key value violates unique constraint "staff_restaurant_code_uniq"',
      );

      const response = await POST(jsonRequest({ name: 'Juan', code: 'JUAN' }));

      expect(response.status).toBe(409);
    });
  });

  describe('PATCH', () => {
    it('uppercases and trims the code before update', async () => {
      mocks.state.updateReturning = [{ id: 9, name: 'Juan', code: 'JUAN', active: true }];

      const response = await PATCH(jsonRequest({ id: 9, code: ' juan ' }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.staff.code).toBe('JUAN');
      expect(mocks.state.updatedSets[0]).toEqual(expect.objectContaining({ code: 'JUAN' }));
    });

    it('returns 409 JSON when another waiter already uses the code', async () => {
      mocks.state.selectRows = [{ id: 12 }];

      const response = await PATCH(jsonRequest({ id: 9, code: 'ana' }));
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe('Ese código ya existe');
      expect(mocks.state.updatedSets).toHaveLength(0);
      const condition = mocks.sqlText(mocks.state.selectConditions[0]);
      expect(condition).toContain('lower(');
      // Excludes the row being edited so a no-op save cannot collide with itself.
      expect(condition).toContain('<>');
    });

    it('returns 409 JSON when the unique index rejects the update', async () => {
      mocks.state.updateError = uniqueViolation();

      const response = await PATCH(jsonRequest({ id: 9, code: 'ANA' }));
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toBe('Ese código ya existe');
    });
  });
});
