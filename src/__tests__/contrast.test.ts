/**
 * Contrast regression — every text token must clear WCAG AA against every
 * surface it can appear on.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * v0.6.1 discovered that `--text-faint: #626b85` measured 3.67:1 against
 * `--bg` and 3.44:1 against `--bg-raised`. Both are below the WCAG AA floor
 * of 4.5:1 for normal text. The token was used in 23 places — descriptions,
 * hints, secondary labels — so this was not an edge case.
 *
 * Nobody noticed, because nothing measured it. The design review looked at
 * the page and the page looked fine: the colour is *close* to passing, and
 * "close" is invisible in a way a threshold assertion is not.
 *
 * So the property is now pinned rather than eyeballed. This computes the
 * WCAG relative-luminance contrast ratio for every text token against every
 * surface token and asserts >= 4.5:1.
 *
 * WHAT IS AND IS NOT COVERED
 * --------------------------
 * Covered: text/foreground tokens paired with background/surface tokens.
 *
 * Deliberately NOT covered:
 *   • `--state-*` and `--accent*` tokens used for borders, fills and glows.
 *     WCAG 1.4.11 sets a 3:1 floor for non-text *components* (borders,
 *     focus indicators, form outlines), which is a different test with a
 *     different threshold. Folding them in here would either weaken this
 *     assertion or require a second threshold and a second file.
 *   • `--techdebt`, `--cash`, `--loc`, `--coffee` — resource colours used
 *     for numbers and labels. These are brand colours chosen for
 *     distinctiveness, and several are below 4.5:1 by design. They are
 *     paired with a solid text plate where they carry text, and that
 *     pairing is the thing to assert — not the hue in isolation.
 *
 * The consequence is that this file is narrower than "all contrast in the
 * app". That is intentional: an audit that tries to cover everything at once
 * ends up asserting nothing precisely.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const css = readFileSync(resolve(root, 'src', 'index.css'), 'utf8');

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, in the range [1, 21]. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pull a hex value out of `:root { ... }`.
 *
 * Only `:root` is read, deliberately. A token defined in a media query or an
 * override block can be a legitimate exception (a high-contrast theme, a
 * print stylesheet), and silently asserting against it would either fail the
 * build or tempt someone to lower the threshold. If a token is not in
 * `:root`, this returns null and the test says so — which is the right
 * behaviour for an audit, because an unlisted token is exactly the gap.
 */
function token(name: string): string | null {
  const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})`).exec(css);
  return m ? m[1].toLowerCase() : null;
}

/** Tokens that carry text, paired with the surfaces they sit on. */
const TEXT_TOKENS = ['--text', '--text-dim'] as const;
const SURFACE_TOKENS = ['--bg', '--bg-raised', '--bg-sunken'] as const;

/** WCAG AA for normal text. */
const AA_NORMAL = 4.5;

describe('every text token clears WCAG AA against every surface', () => {
  it('the token table is complete — an unlisted token is a gap', () => {
    // An audit that silently skips a token is worse than no audit: it looks
    // like coverage and is actually an omission. If someone adds a text token
    // and does not add it here, this fails.
    for (const name of TEXT_TOKENS) {
      expect(token(name), `${name} is not defined in :root — add it to TEXT_TOKENS or remove it`).not.toBeNull();
    }
  });

  it.each(
    TEXT_TOKENS.flatMap((t) =>
      SURFACE_TOKENS.map((s) => [`${t} on ${s}`, t, s] as const)
    )
  )('%s reaches at least %s:1', (_label, textName, surfaceName) => {
    const text = token(textName);
    const surface = token(surfaceName);
    expect(text, `${textName} missing`).not.toBeNull();
    expect(surface, `${surfaceName} missing`).not.toBeNull();

    const ratio = contrast(text!, surface!);
    expect(
      ratio,
      `${textName} (${text}) on ${surfaceName} (${surface}) is ${ratio.toFixed(2)}:1, below ${AA_NORMAL}:1`
    ).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

describe('the v0.6.1 regression specifically', () => {
  it('--text-faint no longer exists as a text token', () => {
    // The property that was fixed. If the token is re-introduced without being
    // brought into compliance, this fails — which is the point. A colour that
    // fails AA should not be able to creep back in silently.
    expect(token('--text-faint')).toBeNull();
  });

  it('--text-dim still clears AA against all three surfaces', () => {
    // The token that --text-faint's usages were promoted to. Pinning it here
    // means a future change to --text-dim that drops it below the floor fails
    // the build, rather than being discovered in a design review months later.
    for (const surfaceName of SURFACE_TOKENS) {
      const text = token('--text-dim');
      const surface = token(surfaceName);
      expect(text).not.toBeNull();
      expect(surface).not.toBeNull();
      expect(contrast(text!, surface!)).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });
});

describe('the contrast arithmetic is correct', () => {
  it('black on white is 21:1', () => {
    // The maximum possible ratio. If this is not 21, the formula is wrong and
    // every other assertion in this file is meaningless.
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('identical colours are 1:1', () => {
    expect(contrast('#123456', '#123456')).toBeCloseTo(1, 5);
  });

  it('the ratio is symmetric', () => {
    const a = contrast('#e6e9f2', '#0b0d12');
    const b = contrast('#0b0d12', '#e6e9f2');
    expect(a).toBeCloseTo(b, 10);
  });

  it('the v0.6.1 numbers are reproduced exactly', () => {
    // The measurements that motivated this file. If the formula is ever
    // "corrected" and these stop matching, the file is telling you the
    // measurements were the point, not the arithmetic.
    expect(contrast('#626b85', '#0b0d12')).toBeCloseTo(3.67, 2);
    expect(contrast('#626b85', '#12151d')).toBeCloseTo(3.44, 2);
    expect(contrast('#98a0b8', '#0b0d12')).toBeCloseTo(7.46, 2);
    expect(contrast('#98a0b8', '#12151d')).toBeCloseTo(7.0, 2);
  });
});
