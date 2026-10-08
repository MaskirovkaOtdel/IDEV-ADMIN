/**
 * Perceivability checks for the event layer.
 *
 * RUNS AGAINST A BUILD, ON PURPOSE
 * -------------------------------
 * These read `dist/assets/*.css` rather than `src/App.css`. The point is to
 * assert on what actually ships: the minifier rewrites translateX to translate,
 * merges adjacent selectors, turns 380ms into .38s and collapses media-query
 * spacing, so a threshold that holds in the source can be absent from the
 * bundle. Three separate assertions here were wrong before this was matched
 * against the real minified output.
 *
 * That dependency has a cost: the suite needs `dist/` to exist, so `npm run
 * verify` builds before testing. It previously ran tests first, which worked
 * locally because a stale `dist/` was always lying around and failed on a clean
 * CI machine.
 *
 * WHY THIS EXISTS
 * ---------------
 * v0.3.0 shipped animations that were technically present and practically
 * invisible: the purchase bloom spread to 14px over 240ms and the meter was 2px
 * tall. Nobody saw them. The existing tests all passed, because they asserted
 * that a class is applied and removed -- a *wiring* property. None of them
 * asserted anything about size or duration, so "technically present, invisibly
 * small" was indistinguishable from working.
 *
 * The v0.3.0 numbers are recorded below as the regression these guard. Anyone
 * lowering them has to change this file, which is the point.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Built stylesheet, so the assertions run against what actually ships. */
let css = '';

beforeAll(() => {
  // src/__tests__/ -> src -> repo root, then dist/assets
  const distAssets = resolve(import.meta.dirname, '..', '..', 'dist', 'assets');
  const file = readdirSync(distAssets).find((f) => f.endsWith('.css'));
  expect(file, 'no built CSS found — run `npm run build` first').toBeDefined();
  css = readFileSync(join(distAssets, file!), 'utf8');
});

/**
 * Largest magnitude of any px value in a rule body.
 *
 * Magnitude, not value. `unlock-in` travels via `translate(-22px)` and
 * `box-shadow: -18px`, all negative; taking Math.max of the raw numbers
 * returned 1 from an unrelated trailing `1px` and made a 22px animation read as
 * a 1px one. Comparing distance travelled means taking absolute values.
 */
function maxPx(rule: string): number {
  const values = [...rule.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Math.abs(Number(m[1])));
  return values.length ? Math.max(...values) : 0;
}

/**
 * Find a rule by selector, ignoring how the minifier spaced or merged it.
 *
 * The built stylesheet is minified: `380ms` becomes `.38s`,
 * `prefers-reduced-motion: reduce` becomes `prefers-reduced-motion:reduce`, and
 * adjacent selectors merge into one rule. Matching the formatted source instead
 * would pass on a build that ships something entirely different.
 *
 * Note the space in `@keyframes flash-bought` *survives* minification, so
 * whitespace is normalised with `\s*` rather than deleted outright -- deleting it
 * produces `@keyframesflash-bought`, which matches nothing. That mistake cost
 * several iterations here and is why the matching is done on a real file rather
 * than on assumptions.
 */
function ruleBody(selector: string): string {
  // Collapse runs of whitespace to a single space, and allow any amount of
  // whitespace in the source selector to match the built one.
  const escaped = selector
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*');
  const re = new RegExp(escaped + '\\s*\\{');
  const m = re.exec(css);
  if (!m) return '';

  // Keyframes need special handling. A `@keyframes` block contains nested
  // `0% { ... }` blocks, so counting braces from the opening one stops at the end
  // of the first frame rather than the end of the animation -- which is how
  // `translateX(-22px)` went missing. Walk to the *last* `}` on the rule's own
  // top level by scanning forward until braces balance, starting depth at 1.
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(m.index, i + 1);
    }
  }
  return css.slice(m.index, m.index + 900);
}

/** Duration in ms from either `380ms` or the minifier's `.38s`. */
function durationMs(rule: string): number {
  const ms = Number(/(\d+)ms/.exec(rule)?.[1] ?? NaN);
  if (Number.isFinite(ms)) return ms;
  const s = Number(/(?:^|[^\d.])\.?(\d*\.?\d+)s/.exec(rule)?.[1] ?? NaN);
  return Number.isFinite(s) ? s * 1000 : 0;
}

describe('event effects are large enough to see', () => {
  it('the purchase bloom reaches at least 20px', () => {
    // v0.3.0 shipped 14px, which was reported as invisible.
    const keyframes = ruleBody('@keyframes flash-bought');
    expect(keyframes, 'flash-bought keyframes missing').not.toBe('');
    expect(maxPx(keyframes)).toBeGreaterThanOrEqual(20);
  });

  it('the purchase bloom runs for at least 300ms', () => {
    // v0.3.0 shipped 240ms, which reads as a flicker rather than a response.
    expect(durationMs(ruleBody('.card.just-bought'))).toBeGreaterThanOrEqual(300);
  });

  it('the purchase bloom washes the card, not just its outline', () => {
    // Animating only box-shadow gives the effect almost no area. The wash is
    // what makes it land.
    const keyframes = ruleBody('@keyframes flash-bought');
    expect(keyframes).toMatch(/background-color/);
  });

  it('the production meter is at least 3px tall', () => {
    // v0.3.0 shipped 2px, which read as a divider rule.
    // Matched without the trailing colon: `.gen-meter:` appears only inside the
    // `is-idle` modifier, and the base rule shares a block with the fill.
    const rule = ruleBody('.gen-meter');
    expect(rule, '.gen-meter rule missing').not.toBe('');
    expect(maxPx(rule)).toBeGreaterThanOrEqual(3);
  });

  it('the meter marks where its level ends', () => {
    const rule = ruleBody('.gen-meter-fill:after');
    expect(rule, 'meter leading edge missing').not.toBe('');
    expect(rule).toMatch(/box-shadow/);
  });

  it('the unlock slide travels far enough to register', () => {
    // v0.3.0 moved 12px; 22px is enough to read as an arrival.
    const keyframes = ruleBody('@keyframes unlock-in');
    expect(keyframes, 'unlock-in keyframes missing').not.toBe('');
    expect(maxPx(keyframes)).toBeGreaterThanOrEqual(20);
  });
});

describe('motion is still suppressible', () => {
  it('every event effect is covered by the reduced-motion block', () => {
    // Sizing the effects up must not have cost the accessibility path.
    const block = ruleBody('@media (prefers-reduced-motion: reduce)');
    expect(block, 'reduced-motion block missing').not.toBe('');
    for (const sel of ['.card.just-bought', '.card.just-unlocked', '.workspace.is-burning']) {
      expect(block).toContain(sel);
    }
  });

  it('there is no blanket animation-killing override', () => {
    // `* { animation-duration: 0.01ms !important }` was the first attempt and it
    // was wrong twice: it neutralises event feedback rather than replacing it,
    // and it would silently flatten any animation added later.
    expect(css).not.toMatch(/\*\{[^}]*0\.01ms/);
  });
});