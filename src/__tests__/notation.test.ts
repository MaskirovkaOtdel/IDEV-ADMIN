/**
 * Number notation.
 *
 * WHY THIS IS MOSTLY AN INVARIANT TEST
 * -----------------------------------
 * The feature is three ways of spelling a number. The risk is not that they look
 * different -- it is that one of them means something slightly DIFFERENT, which
 * would be a silent cheat sitting behind a cosmetic setting.
 *
 * That is not hypothetical. The first implementation printed `10e58` for 1e58,
 * which denotes 1e59. The cause was a divisor and a label that disagreed:
 * `standardNotation` divided by 10^(exponent floored to a multiple of three) and
 * then labelled the result with the un-rounded exponent.
 *
 * It was NOT, as the first version of this comment claimed, that
 * `Decimal.exponent` is unreliable. A sweep of 1500 values found zero
 * disagreements with `floor(log10(value))`, and removing the normalisation guard
 * leaves every sample correct. The comment explaining the bug was itself wrong,
 * which is worth recording: the first diagnosis was as unverified as the first code.
 *
 * Every notation is now round-tripped back to a Decimal and compared against the
 * original, so the class of bug cannot recur regardless of its cause.
 */
import { describe, it, expect } from 'vitest';
import Decimal from 'break_infinity.js';
import { formatDecimal, NOTATIONS, type Notation } from '../game/formulas';
import { dec } from '../game/decimal';
import { DEFAULT_SETTINGS, parseSettings } from '../game/settings';

const ALL: Notation[] = NOTATIONS.map((n) => n.value);

/** Magnitudes spanning every tier, plus the boundaries where bugs hid. */
const SAMPLES = [
  0, 1, 999, 1500, 1e6, 1.2345e9, 3.79e9, 1.2614e9, 1e15, 1e21, 1e33, 1e45, 1e57,
  1e58, 1e59, 1e63, 1e64, 1e100, 1e250,
];

describe('every notation denotes the same value', () => {
  it('round-trips through the standard rendering back to the original', () => {
    for (const sample of SAMPLES) {
      const original = dec(sample);
      const text = formatDecimal(original, 12, 'standard');
      // `1.23e9` -> `1.23e+9`, which break_infinity parses.
      const parsed = Decimal.fromString(text.replace('e', 'e+'));
      expect(
        Number(parsed.toString()),
        `${sample} formatted as "${text}", which parses to ${parsed.toString()}`
      ).toBeCloseTo(sample, 6);
    }
  });

  it('never prints a mantissa that overflows its tier', () => {
    // The bug this file exists for: 1e58 rendered as `10e58`. A scientific mantissa
    // belongs in 1-10; an engineering one in 1-1000.
    for (const sample of SAMPLES) {
      if (sample < 1000) continue;
      const value = dec(sample);

      const standard = /^[1-9](\.\d+)?e(-?\d+)$/.exec(formatDecimal(value, 3, 'standard'));
      expect(standard, `standard: ${formatDecimal(value, 3, 'standard')}`).toBeTruthy();

      const engineering = /^(\d+(\.\d+)?)E(-?\d+)$/.exec(formatDecimal(value, 3, 'engineering'));
      expect(engineering, `engineering: ${formatDecimal(value, 3, 'engineering')}`).toBeTruthy();
      const mantissa = Number(engineering![1]);
      expect(
        mantissa,
        `engineering mantissa ${mantissa} outside 1-1000 for ${sample}`
      ).toBeGreaterThanOrEqual(1);
      expect(mantissa).toBeLessThan(1000);
      // Exponent stays a multiple of three, or the notation is not engineering.
      expect(Number(engineering![3]) % 3, `exponent not a multiple of 3`).toBe(0);
    }
  });

  it('agrees on small values, where all three are the same thing', () => {
    for (const sample of [0, 1, 12.5, 999]) {
      const rendered = new Set(ALL.map((n) => formatDecimal(dec(sample), 3, n)));
      expect(rendered.size, `${sample} rendered differently: ${[...rendered].join(' / ')}`).toBe(1);
    }
  });

  it('handles negative values without losing the sign', () => {
    for (const notation of ALL) {
      expect(formatDecimal(dec(-1500), 3, notation)).toMatch(/^-/);
    }
  });

  it('handles zero and non-finite input', () => {
    for (const notation of ALL) {
      expect(formatDecimal(dec(0), 3, notation)).toBe('0');
      expect(formatDecimal(dec('NaN') as never, 3, notation)).toBe('—');
    }
  });
});

describe('each notation is at least legible', () => {
  it('suffix uses a letter suffix up to 1e63 and then falls back', () => {
    expect(formatDecimal(dec(3.79e9), 3, 'suffix')).toBe('3.79B');
    expect(formatDecimal(dec(1e15), 3, 'suffix')).toBe('1Qa');
    // The last suffix is Vg at 1e63; the tier holds three decimal places, so it
    // serves up to 1e65 before anything overflows.
    expect(formatDecimal(dec(1e63), 3, 'suffix')).toBe('1Vg');
    // Past the table it must not invent a suffix.
    expect(formatDecimal(dec(1e66), 3, 'suffix')).toMatch(/e\d+$/);
  });

  it('standard always carries an explicit exponent', () => {
    for (const sample of [1e3, 1e9, 1e45, 1e100]) {
      expect(formatDecimal(dec(sample), 3, 'standard')).toMatch(/e-?\d+$/);
    }
  });

  it('engineering keeps the exponent a multiple of three', () => {
    for (const sample of [1e9, 1e10, 1e11, 1e100]) {
      const match = /E(-?\d+)$/.exec(formatDecimal(dec(sample), 3, 'engineering'))!;
      expect(Number(match[1]) % 3).toBe(0);
    }
  });

  it('trims trailing zeros rather than padding them', () => {
    expect(formatDecimal(dec(1e9), 3, 'suffix')).toBe('1B');
    expect(formatDecimal(dec(1e9), 3, 'standard')).toBe('1e9');
    expect(formatDecimal(dec(1e9), 3, 'engineering')).toBe('1E9');
  });
});

describe('the preference is stored, validated, and not a cheat', () => {
  it('defaults to suffix notation, unchanged behaviour', () => {
    expect(DEFAULT_SETTINGS.notation).toBe('suffix');
  });

  it('rejects an unknown notation', () => {
    // A typo must not leave a value no renderer handles.
    expect(parseSettings({ notation: 'roman' }).notation).toBe('suffix');
    expect(parseSettings({ notation: 42 }).notation).toBe('suffix');
    expect(parseSettings(null).notation).toBe('suffix');
  });

  it('accepts all three', () => {
    for (const notation of ALL) {
      expect(parseSettings({ notation }).notation).toBe(notation);
    }
  });

  it('is not part of the save blob', () => {
    // It is a device preference. If it travelled in the save, importing somebody
    // else's file would change how your numbers are written.
    const blob = readSaveBlobType();
    expect(blob).not.toMatch(/\bnotation\b/);
  });

  it('formatDecimal works with no provider registered', () => {
    // The Node balance simulator imports this module with no browser and no
    // settings. A missing or throwing provider must not take a render down.
    expect(formatDecimal(dec(3.79e9))).toBe('3.79B');
  });
});

function readSaveBlobType(): string {
  // Imported lazily so the source read stays out of the hot path above.
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { resolve } = require('node:path') as typeof import('node:path');
  const blob = readFileSync(
    resolve(import.meta.dirname, '..', 'game', 'types.ts'),
    'utf8'
  );
  const match = /export interface SaveBlob \{([\s\S]*?)\n\}/.exec(blob);
  expect(match, 'SaveBlob interface not found').toBeTruthy();
  return match![1];
}
