/**
 * Client/server bundle boundary.
 *
 * This test exists because the /quotes list shipped broken for every user from
 * 10 sep 2026 to 14 sep 2026 and nobody noticed until a customer hit it:
 *
 *   QuoteList.tsx is a 'use client' component. It imported ACTIVE_STATUSES,
 *   STATUS_LABELS, STATUS_COLORS and formatPesos as *runtime values* from
 *   @/lib/quote-lifecycle, and that module imports @/db. So src/db/index.ts —
 *   which reads process.env.DATABASE_URL at module scope — was bundled into the
 *   browser. Next inlines only NEXT_PUBLIC_* vars on the client, so
 *   process.env.DATABASE_URL is undefined in the browser and module evaluation
 *   threw:
 *
 *     TypeError: undefined is not an object
 *       (evaluating 'process.env.DATABASE_URL.replace')
 *         at src/db/index.ts:7
 *
 *   The throw happened before React could render, so the page fell through to
 *   app/global-error.tsx: "Algo salio mal". The server render was fine, which is
 *   why curl and every server-side check said the page was healthy.
 *
 * The rule this test enforces: a client component may import *types* from
 * anywhere, but the only modules it may import *values* from are modules that
 * can run in a browser. Types are erased at compile time; values are not.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');

/** Modules a browser bundle must never contain: they touch the DB or secrets. */
const SERVER_ONLY_MODULES = new Set(['@/db', '@/db/schema', '@/db/index']);

/** Non-public env reads, evaluated at module scope, that cannot work client-side. */
const SERVER_ENV_AT_MODULE_SCOPE = /process\.env\.[A-Z0-9_]+(?!\s*[=:])/;
const PUBLIC_ENV_PREFIX = 'process.env.NEXT_PUBLIC_';

interface ParsedModule {
  /** Absolute path of the file. */
  path: string;
  /** Specifiers imported for their *runtime value* (not `import type`). */
  valueImports: string[];
  /** Whole file source. */
  source: string;
}

function allSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) allSourceFiles(p, acc);
    else if (/\.(ts|tsx)$/.test(p)) acc.push(p);
  }
  return acc;
}

/**
 * Strip `import type` / `export type` statements, then collect the specifiers of
 * everything that remains. A type-only import is erased by the compiler and must
 * not count as a bundle edge — that distinction is the whole point of this test.
 */
function importsWithRuntimeEffect(source: string): string[] {
  const withoutTypeImports = source
    .replace(/^\s*import\s+type\s[\s\S]*?from\s*['"][^'"]+['"];?/gm, '')
    .replace(/^\s*export\s+type\s[\s\S]*?from\s*['"][^'"]+['"];?/gm, '');

  const specifiers: string[] = [];
  const staticImport = /(?:^|\n)\s*(?:import|export)\s[\s\S]*?from\s*['"]([^'"]+)['"]/g;
  const bareSideEffectImport = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [staticImport, bareSideEffectImport, dynamicImport]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(withoutTypeImports))) specifiers.push(m[1]);
  }
  return specifiers;
}

function load(file: string): ParsedModule {
  const source = readFileSync(file, 'utf8');
  return { path: file, valueImports: importsWithRuntimeEffect(source), source };
}

/** '@/lib/x' -> src/lib/x; './y' -> sibling of `from`. Null for npm packages. */
function resolveSpecifier(spec: string, from: string): string | null {
  if (spec.startsWith('@/')) return join(ROOT, spec.slice(2));
  if (spec.startsWith('.')) return resolve(dirname(from), spec);
  return null;
}

/** A module that can only run on the server, however it is reached. */
function serverOnlyReason(mod: ParsedModule): string | null {
  if (SERVER_ONLY_MODULES.has(moduleSpecifier(mod.path))) {
    return 'is a server-only module (DB client / schema)';
  }
  // Scan code, not prose: the incident explanation in these files quotes the
  // exact throwing expression, and that must not itself read as a violation.
  const code = stripComments(mod.source);
  const envReads = code.match(new RegExp(SERVER_ENV_AT_MODULE_SCOPE, 'g')) ?? [];
  const nonPublic = envReads.filter((r) => !r.startsWith(PUBLIC_ENV_PREFIX));
  if (nonPublic.length > 0) {
    // Only module-scope reads matter: env read inside a function body is never
    // evaluated in the browser unless that function is called.
    const beforeFirstFunction = moduleScopeChunk(code);
    const offending = nonPublic.filter((r) => beforeFirstFunction.includes(r));
    if (offending.length > 0) {
      return `reads ${offending[0]} at module scope, which is undefined in the browser`;
    }
  }
  return null;
}

/** Comment-free source (a regex/string containing '//' is left alone). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, (_m, lead: string) => lead);
}

/** Everything before the first top-level `function`/arrow-const, where module init lives. */
function moduleScopeChunk(code: string): string {
  const boundary = code.search(
    /\n(?:export\s+)?(?:async\s+)?function\s|\n(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(/,
  );
  return boundary === -1 ? code : code.slice(0, boundary);
}

/** How a header file refers to a path, for readable assertions. */
function moduleSpecifier(path: string): string {
  const rel = relative(join(ROOT, '..', 'src'), path).replace(/\\/g, '/');
  return `@/${rel.replace(/\.(ts|tsx)$/, '')}`;
}

/** Breadth-first walk of every module a client file pulls *values* from. */
function clientReachableGraph(entry: string): Array<{ path: string; via: string }> {
  const reached = new Map<string, string>();
  const queue: Array<{ file: string; via: string }> = [{ file: entry, via: '(entry)' }];
  while (queue.length > 0) {
    const { file, via } = queue.shift()!;
    if (reached.has(file)) continue;
    reached.set(file, via);
    const mod = load(file);
    for (const spec of mod.valueImports) {
      const target = resolveSpecifier(spec, mod.path);
      if (!target) continue;
      for (const candidate of [
        target,
        `${target}.ts`,
        `${target}.tsx`,
        join(target, 'index.ts'),
        join(target, 'index.tsx'),
      ]) {
        try {
          if (statSync(candidate).isFile()) {
            if (!reached.has(candidate)) queue.push({ file: candidate, via: spec });
            break;
          }
        } catch {
          /* not this extension */
        }
      }
    }
  }
  reached.delete(entry);
  return [...reached.entries()].map(([path, via]) => ({ path, via }));
}

const clientFiles = allSourceFiles(join(ROOT, 'app'))
  .concat(allSourceFiles(join(ROOT, 'components')))
  .filter((f) => /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')));
const sharedClientModules = allSourceFiles(join(ROOT, 'lib')).filter((f) =>
  /^\s*['"]use client['"]/.test(readFileSync(f, 'utf8')),
);

describe('client/server bundle boundary', () => {
  it('finds the client components it is meant to police', () => {
    expect(clientFiles.length).toBeGreaterThan(20);
  });

  it.each([...clientFiles, ...sharedClientModules].map((f) => [relative(ROOT, f), f]))(
    '%s pulls no server-only module into the browser bundle',
    (_label, file) => {
      const violations = clientReachableGraph(file)
        .map(({ path, via }) => ({ module: moduleSpecifier(path), via, reason: serverOnlyReason(load(path)) }))
        .filter((v) => v.reason !== null);

      expect(
        violations.map((v) => `${v.module} ${v.reason} (imported via '${v.via}')`),
      ).toEqual([]);
    },
  );

  it('the DB client refuses to be a client dependency (the exact /quotes throw)', () => {
    const dbModule = load(join(ROOT, 'db', 'index.ts'));
    expect(dbModule.source).toContain('process.env.DATABASE_URL');
    // If this ever changes, SERVER_ENV_AT_MODULE_SCOPE must be re-checked.
    expect(serverOnlyReason(dbModule)).not.toBeNull();
  });
});
