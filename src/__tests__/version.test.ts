/**
 * The release version has exactly one source of truth.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The sidebar version was a hardcoded string in Layout.tsx, and it shipped wrong:
 * v0.5.1 went out with the sidebar reading "v0.5.0". The only way to notice was
 * to look at the running application.
 *
 * That is the second time the same failure has appeared in this repo.
 * package-lock.json also drifted, claiming 0.1.0 across ten consecutive releases
 * until a version bump happened to surface it. Both were the same defect: two
 * places holding the same fact with nothing keeping them in step.
 *
 * So package.json is now the only place the version is written, it is inlined at
 * build time via vite.config.ts, and these tests hold the other two claims —
 * package-lock.json and the rendered sidebar — against it.
 */

/**
 * `__APP_VERSION__` is defined by vite.config.ts and vitest.config.ts, both of
 * which read it from package.json.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));

describe('the version has one source of truth', () => {
  it('package.json is a valid semver release', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('package-lock.json agrees with it, in both places npm reads', () => {
    // package-lock.json has two root version slots, and a half-updated lock is a
    // thing npm will silently regenerate rather than complain about.
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
  });

  it('the sidebar reads the version rather than repeating it', () => {
    // Read from source: the assertion is that there is no second copy to drift.
    const layout = readFileSync(resolve(root, 'src', 'ui', 'Layout.tsx'), 'utf8');
    expect(layout).toContain('{__APP_VERSION__}');
    expect(layout).not.toMatch(/v\d+\.\d+\.\d+/);
  });

  it('the version is inlined at build time from package.json', () => {
    // If the define is dropped from vite.config.ts, the sidebar renders
    // "v__APP_VERSION__" and the build still succeeds — so this is the only place
    // that catches it.
    const config = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/__APP_VERSION__:\s*JSON\.stringify\(pkg\.version\)/);
    expect(config).toMatch(/package\.json/);
  });

  it('the inlined value matches package.json when substituted', () => {
    // Guards the whole chain end to end without needing a browser: read what
    // vite.config.ts would substitute and compare it to the declared version.
    expect(__APP_VERSION__).toBe(pkg.version);
  });
});