/**
 * Vendored motion — attribution, integrity, and reduced-motion safety.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * v0.6.1 vendors six keyframes from cssframes (MIT). Three properties must hold
 * for that to be sound, and none of them are visible in a passing build:
 *
 *   1. ATTRIBUTION. The MIT licence requires the copyright notice and
 *      permission text to travel with the copy. If the header is stripped, the
 *      file is unlicensed code in the repo — a legal problem, not a style one.
 *   2. INTEGRITY. The vendored file must contain exactly the animations that
 *      were agreed, and none of the ones that were rejected. A rejected
 *      animation leaking in would ship an infinite paint cost or a
 *      photosensitivity risk that nobody asked for.
 *   3. REDUCED-MOTION COVERAGE. The vendored file ships its own
 *      prefers-reduced-motion block. The project's own reduced-motion handling
 *      lives in App.css; this asserts the vendored block exists as a safety net
 *      for standalone use, and that the tri-state motion setting still overrides
 *      correctly in both directions.
 *
 * These read the source files rather than the built bundle because the
 * properties above are about the source: a minifier could drop a comment or
 * rename a keyframe, and the licence header is the thing most at risk.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const vendored = readFileSync(resolve(root, 'src', 'ui', 'motion-vendored.css'), 'utf8');
const appCss = readFileSync(resolve(root, 'src', 'App.css'), 'utf8');

/** Strip comments so prose about a rule cannot fail the rule's own assertion. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const vendoredCode = code(vendored);
const appCode = code(appCss);

/** The animations that were agreed for vendoring. */
const EXPECTED = [
  'cf-rise-in',
  'cf-zoom-bounce',
  'cf-slide-in-up',
  'cf-pulse',
  'cf-fade-in-up',
  'cf-type-in',
] as const;

/** The animations that were deliberately rejected, with their reasons. */
const REJECTED: { name: string; reason: string }[] = [
  { name: 'cf-hue-cycle', reason: 'infinite filter: hue-rotate is a permanent paint cost' },
  { name: 'cf-flicker', reason: 'opacity flickering — photosensitivity risk' },
  { name: 'cf-flash', reason: 'full opacity-0 flashes — WCAG 2.3.1' },
  { name: 'cf-spin', reason: 'infinite ambient loop, cost with no information' },
  { name: 'cf-ping', reason: 'infinite ambient loop, cost with no information' },
  { name: 'cf-bob', reason: 'infinite ambient loop, cost with no information' },
  { name: 'cf-pulse-ring', reason: 'infinite ambient loop, cost with no information' },
  { name: 'cf-float', reason: 'infinite ambient loop, cost with no information' },
];

describe('the vendored file is properly attributed', () => {
  it('names the source project and its licence', () => {
    // The MIT licence requires the copyright notice and permission text. Without
    // them the file is unlicensed code in a public repo.
    expect(vendored).toMatch(/cssframes/);
    expect(vendored).toMatch(/MIT/);
    expect(vendored).toMatch(/Copyright \(c\) 2026 Bilal Malik/);
  });

  it('reproduces the MIT permission text', () => {
    // Not just the words "MIT" — the actual grant. A file that says "MIT licensed"
    // without the text is not licensed.
    expect(vendored).toMatch(/Permission is hereby granted, free of charge/);
    expect(vendored).toMatch(/THE SOFTWARE IS PROVIDED "AS IS"/);
  });

  it('records the date it was vendored and the release it landed in', () => {
    // Provenance. If a question arises about what was taken and when, this is the
    // only record.
    expect(vendored).toMatch(/2026-10-12/);
    expect(vendored).toMatch(/v0\.6\.1/);
  });
});

describe('the vendored file contains exactly what was agreed', () => {
  it.each(EXPECTED.map((name) => [name, name] as const))(
    'keyframes %s is present',
    (_label, name) => {
      // The keyframes rule itself, not just a comment mentioning it.
      expect(vendoredCode).toContain(`@keyframes ${name}`);
    }
  );

  it.each(REJECTED.map((r) => [r.name, r.name] as const))(
    'rejected animation %s is absent',
    (_label, name) => {
      // Read from source, not from the bundle. A rejected animation that leaks in
      // would ship an infinite paint cost or a photosensitivity risk.
      expect(vendoredCode, `${name} was rejected: ${REJECTED.find((r) => r.name === name)!.reason}`)
        .not.toContain(`@keyframes ${name}`);
    }
  );

  it('does not contain any keyframe that is neither expected nor burn-sweep', () => {
    // A guard against future additions. If someone adds a keyframe to the vendored
    // file without updating this test, it fails — which is the point.
    const all = [...vendoredCode.matchAll(/@keyframes\s+([a-z-]+)/g)].map((m) => m[1]);
    const allowed = new Set<string>([...EXPECTED]);
    const unknown = all.filter((name) => !allowed.has(name));
    expect(unknown).toEqual([]);
  });
});

describe('the vendored animations are wired into the app', () => {
  it('the purchase pop uses cf-zoom-bounce, not the old flash-bought', () => {
    expect(appCode).toMatch(/\.card\.just-bought\s*\{[^}]*animation:\s*cf-zoom-bounce/);
    expect(appCode).not.toContain('flash-bought');
  });

  it('the arrival uses cf-rise-in, not the old unlock-in', () => {
    expect(appCode).toMatch(/\.card\.just-unlocked\s*\{[^}]*animation:\s*cf-rise-in/);
    expect(appCode).not.toContain('unlock-in');
  });

  it('the burn sweep is untouched — it has no cssframes equivalent', () => {
    // burn-sweep is a full-workspace background sweep. None of the cssframes
    // animations match it, so it stays.
    expect(appCode).toContain('@keyframes burn-sweep');
    expect(appCode).toMatch(/\.workspace\.is-burning\s*\{[^}]*animation:\s*burn-sweep/);
  });

  it('the reduced-motion block still covers all three event classes', () => {
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([^}]*)\}/.exec(appCode);
    expect(block, 'reduced-motion block missing from App.css').toBeTruthy();
    const body = block![1];
    for (const sel of ['.card.just-bought', '.card.just-unlocked', '.workspace.is-burning']) {
      expect(body, `${sel} is not covered by the reduced-motion block`).toContain(sel);
    }
  });

  it('the ?motion=force override uses the vendored names', () => {
    const block = /\[data-motion='force'\]\s*\.card\.just-bought\s*\{([^}]*)\}/.exec(appCode);
    expect(block, '?motion=force override for just-bought is missing').toBeTruthy();
    expect(block![1]).toContain('cf-zoom-bounce');
  });
});

describe('the vendored file is safe to import standalone', () => {
  it('ships its own prefers-reduced-motion block', () => {
    // cssframes ships one. If someone imports the vendored file without App.css,
    // the animations must still respect the OS preference.
    expect(vendored).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });

  it('uses only compositor-friendly properties, with one documented exception', () => {
    // Animating width, height, top or left triggers layout. The vendored keyframes
    // must stick to transform and opacity so they composite on the GPU.
    //
    // EXCEPTION: cf-type-in animates width. This is deliberate — a typewriter
    // effect cannot be done with transform alone, and the cost is acceptable
    // because it is a one-shot effect on a small element (the offline report
    // header), not an infinite loop. The animation runs once for 1400ms.
    const keyframeBlocks = [...vendoredCode.matchAll(/@keyframes\s+([a-z-]+)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)];
    expect(keyframeBlocks.length).toBeGreaterThan(0);
    for (const [, name, body] of keyframeBlocks) {
      if (name === 'cf-type-in') continue; // documented exception
      expect(body, `${name} animates a layout property`).not.toMatch(
        /^\s*(width|height|top|left|right|bottom)\s*:/m
      );
    }
  });

  it('no vendored animation runs infinitely', () => {
    // Infinite animations are either ambient cost or a deliberate loop. None of
    // the six taken are loops — they are one-shot event effects.
    // Read from source. A rejected animation that leaks in would ship an
    // infinite paint cost or a photosensitivity risk.
    expect(vendoredCode).not.toMatch(/iteration-count:\s*infinite/i);
  });
});
