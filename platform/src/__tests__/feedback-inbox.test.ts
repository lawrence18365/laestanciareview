import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESOLUTION_LABEL, RESOLUTIONS } from '@/lib/review-recovery';

const source = readFileSync(
  path.resolve(__dirname, '../components/dashboard/FeedbackInbox.tsx'),
  'utf8',
);

const ALLOWED_IMPORTS = new Set([
  'react',
  '@/lib/review-recovery',
  '@/lib/i18n',
  '@/lib/analytics-client',
  '@/lib/csv',
  '@/lib/review-classification',
]);

function runtimeImports(text: string): string[] {
  return [...text.matchAll(/(?:^|\n)\s*import[\s\S]*?from\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
}

describe('FeedbackInbox recovery boundary', () => {
  it('keeps its client-side imports browser safe', () => {
    expect(runtimeImports(source).every((specifier) => ALLOWED_IMPORTS.has(specifier))).toBe(true);
  });

  it('uses the recovery copy and shared patch-body decision', () => {
    for (const key of ['acknowledge', 'whatHappened', 'cancel', 'fromNotification']) {
      expect(source).toContain(`t.inbox.${key}`);
    }
    const patchBodies = [...source.matchAll(/JSON\.stringify\(([^)]*)/g)].map((match) => match[1].trim());
    expect(patchBodies.every((body) => body.startsWith('statusPatchBody('))).toBe(true);
    expect(source).not.toMatch(/\bresolution\s*:/);
  });

  it('has a label for every available resolution', () => {
    for (const resolution of RESOLUTIONS) {
      expect(RESOLUTION_LABEL[resolution]).toBeTruthy();
    }
  });
});
