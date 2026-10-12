/**
 * The restaurant's uploaded logo is stored in the same row as everything else
 * and can be up to 280 KB, so hot-path queries must project it away and keep
 * only the cheap md5 version tag. This is the field-level guard for that
 * invariant: a future refactor that goes back to `select()` on `restaurants`
 * fails here (and in /api/logo, which is the only reader of the bytes).
 */
import { describe, expect, it, vi } from 'vitest';
import { getTableColumns } from 'drizzle-orm';

vi.mock('@/db', () => ({ db: {}, transactionDb: {} }));

import { logoHashSql, restaurantColumnsWithoutLogo } from '@/lib/queries';
import { restaurants } from '@/db/schema';

/** Flatten a drizzle SQL template into its literal text + referenced columns. */
function sqlText(node: unknown): string {
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value;
      if (Array.isArray(value)) return value.join('');
      if (typeof value === 'string') return value;
      if (typeof value === 'number') return String(value);
      const name = (chunk as { name?: unknown }).name;
      return typeof name === 'string' ? name : '';
    })
    .join('');
}

describe('restaurantColumnsWithoutLogo', () => {
  it('projects every restaurant column except logoDataUrl, plus logoHash', () => {
    const allColumns = Object.keys(getTableColumns(restaurants));
    const projected = Object.keys(restaurantColumnsWithoutLogo());

    expect(projected).not.toContain('logoDataUrl');
    expect(projected).toContain('logoHash');
    expect(projected.sort()).toEqual(
      [...allColumns.filter((name) => name !== 'logoDataUrl'), 'logoHash'].sort(),
    );
  });

  it('computes the version tag from logo_data_url inside Postgres', () => {
    const text = sqlText(logoHashSql);

    expect(text).toContain('substr');
    expect(text).toContain('md5');
    // The data URL is referenced (and hashed) by the database, never returned:
    // a NULL logo makes the whole expression NULL, not a bogus tag.
    expect(text).toContain('logo_data_url');
  });
});
