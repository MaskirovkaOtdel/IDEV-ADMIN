/**
 * Cost, production and formatting math for IDEV : ADMIN.
 *
 * COST MODEL
 * ----------
 * `baseCost` is the price of the first unit, so with `owned` units already held
 * the marginal price of the next unit is:
 *
 *   cost(owned) = baseCost * costGrowth^owned * costDiscount
 *
 * Buying `count` units at once (starting from `owned`) costs the geometric sum:
 *
 *   sum_{i=owned}^{owned+count-1} baseCost * costGrowth^i * costDiscount
 *     = baseCost * costDiscount * (costGrowth^(owned+count) - costGrowth^owned)
 *         / (costGrowth - 1)
 *
 * `maxAffordable` inverts that sum with a logarithm, so MAX purchases are O(1)
 * instead of a binary search.
 */
import Decimal from 'break_infinity.js';
import { dec, isNaNDecimal, ONE, ZERO } from './decimal';
import type { ResourceId } from './types';
import { REVENUE_PER_COFFEE, REVENUE_PER_LOC } from './generators';

/** Guard so a costGrowth delta can never make prices collapse or invert. */
export const MIN_COST_GROWTH = 1.02;

/** Apply a flat additive cost-growth delta (from upgrades) safely. */
export function effectiveCostGrowth(costGrowth: number, delta: number): number {
  return Math.max(MIN_COST_GROWTH, costGrowth + delta);
}

/** Cost of buying the next single unit when `owned` are already held. */
export function costForNextUnit(
  baseCost: Decimal,
  costGrowth: number,
  owned: number,
  costDiscount: Decimal = ONE
): Decimal {
  const n = Math.max(0, Math.floor(owned));
  return baseCost.times(Decimal.pow(dec(costGrowth), n)).times(costDiscount);
}

/** Total cost of buying `count` more units. Returns ZERO when count <= 0. */
export function costForBulkPurchase(
  baseCost: Decimal,
  costGrowth: number,
  owned: number,
  count: number,
  costDiscount: Decimal = ONE
): Decimal {
  const units = Math.floor(count);
  if (units <= 0) return ZERO;

  const start = Math.max(0, Math.floor(owned));
  const growth = Math.max(MIN_COST_GROWTH, costGrowth);
  const growthDec = dec(growth);

  // baseCost * costDiscount * g^start * (g^units - 1) / (g - 1)
  const series = growthDec.pow(units).minus(ONE).divide(growthDec.minus(ONE));
  return baseCost.times(costDiscount).times(growthDec.pow(start)).times(series);
}

/**
 * Largest number of units affordable with `budget`, or 0.
 *
 * Inverts the geometric sum:
 *   budget >= baseCost * costDiscount * g^start * (g^n - 1) / (g - 1)
 *   =>  n <= log_g( 1 + budget * (g - 1) / (baseCost * costDiscount * g^start) )
 */
export function maxAffordable(
  baseCost: Decimal,
  costGrowth: number,
  owned: number,
  budget: Decimal,
  costDiscount: Decimal = ONE
): number {
  if (budget.lessThanOrEqualTo(ZERO)) return 0;

  const start = Math.max(0, Math.floor(owned));
  const growth = Math.max(MIN_COST_GROWTH, costGrowth);

  const baseForRun = baseCost.times(costDiscount).times(Decimal.pow(dec(growth), start));
  if (baseForRun.lessThanOrEqualTo(ZERO)) return 0;

  const ratio = budget.times(dec(growth - 1)).div(baseForRun).plus(ONE);
  if (ratio.lessThanOrEqualTo(ONE)) return 0;

  // Decimal.log10 works for arbitrarily large magnitudes.
  const estimate = Decimal.log10(ratio) / Decimal.log10(dec(growth));
  let count = Math.floor(estimate);
  if (!Number.isFinite(count) || count <= 0) return 0;

  // Decimal rounding can be off by one either way; correct it exactly.
  while (count > 0 && costForBulkPurchase(baseCost, growth, start, count, costDiscount).greaterThan(budget)) {
    count -= 1;
  }
  while (costForBulkPurchase(baseCost, growth, start, count + 1, costDiscount).lessThanOrEqualTo(budget)) {
    count += 1;
    if (count > 1e9) break; // safety valve; unreachable in practice
  }
  return count;
}

/**
 * Cash per second one unit of a generator's output is worth.
 *
 * Only LoC and Coffee convert: stockpiles of both bill out as Cash every second,
 * which is exactly what `computeProductionSnapshot` credits to `perResource.cash`.
 * Cash generators are already cash, so they convert at 1.
 *
 * This exists because the UI has to compare generators that produce different
 * things. Dividing `24.75 LoC/s` by `26.4 cash/s` produces a number, but not a
 * meaningful one -- the first is worth 1.24 cash/s and the second 26.4. A meter
 * built on raw rates showed Code Review at 94% of the bar while it contributed
 * under 3% of actual income.
 */
export function cashValueOf(resource: ResourceId, rate: Decimal): Decimal {
  switch (resource) {
    case 'linesOfCode':
      return rate.times(dec(REVENUE_PER_LOC));
    case 'coffee':
      return rate.times(dec(REVENUE_PER_COFFEE));
    case 'cash':
      return rate;
  }
}

/** Production per second for one generator type, before global stacking. */
export function computeProduction(
  baseRate: Decimal,
  owned: number,
  perGeneratorMult: Decimal = ONE,
  perResourceMult: Decimal = ONE,
  globalMult: Decimal = ONE
): Decimal {
  if (owned <= 0) return ZERO;
  return baseRate
    .times(owned)
    .times(perGeneratorMult)
    .times(perResourceMult)
    .times(globalMult);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const SUFFIXES = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
  'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg',
];

/**
 * How large numbers are rendered.
 *
 * Suffix, standard and engineering differ only in SPELLING. Every one of them
 * denotes the same value, and the test suite asserts that for a spread of
 * magnitudes -- notation is display, never arithmetic. That boundary matters: a
 * notation setting that changed what a number means would be a cheat, silently.
 *
 *   suffix       3.79B, 1Qa, 10OcDc. Readable to about 1e21, then the suffixes
 *                stop being English (`QaDc`, `SxDc`). Falls back to scientific
 *                past 1e63.
 *   standard     3.790e9, 1.000e15. Always unambiguous, never as quick to scan.
 *   engineering  3.79E9, 1.0E15. Exponents stay multiples of three, so the mantissa
 *                never runs 1-9999 and columns of numbers stay comparable.
 */
export type Notation = 'suffix' | 'standard' | 'engineering';

export const NOTATIONS: { value: Notation; label: string; hint: string }[] = [
  { value: 'suffix', label: 'Suffix', hint: '3.79B — readable up to about 1e21.' },
  { value: 'standard', label: 'Standard', hint: '3.790e9 — never ambiguous.' },
  { value: 'engineering', label: 'Engineering', hint: '3.79E9 — exponents stay multiples of 3.' },
];

const DEFAULT_NOTATION: Notation = 'suffix';

/**
 * Round to `digits` significant figures and render in `notation`.
 *
 * Defaults to the player's saved preference. Kept as a parameter rather than read
 * inside so the test suite can render one value under every notation and compare --
 * which is how "these are spellings of the same number" is actually checked.
 */
export function formatDecimal(
  value: Decimal,
  digits = 3,
  notation: Notation = currentNotation()
): string {
  if (isNaNDecimal(value)) return '—';
  if (value.eq(ZERO)) return '0';
  if (value.lt(ZERO)) return '-' + formatDecimal(value.negate(), digits, notation);

  // Below 1000 every notation agrees, and a plain decimal is what all three mean.
  if (value.lt(1000)) {
    const fixed = value.toFixed(2);
    return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  }

  switch (notation) {
    case 'standard':
      return standardNotation(value, digits);
    case 'engineering':
      return engineeringNotation(value, digits);
    case 'suffix':
      return suffixNotation(value, digits);
  }
}

/**
 * Split into mantissa and exponent, normalised so the mantissa is in [1, base).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, CORRECTLY THIS TIME
 * ---------------------------------------------------------------------------
 * The first version of this file carried a comment claiming `Decimal.exponent` is
 * unreliable and "reports 57 for 1e58". That was false. A sweep of 1500 values
 * found zero disagreements between `Decimal.exponent` and `floor(log10(value))`,
 * and deleting this normalisation entirely leaves every sample rendering
 * correctly. The comment was written to explain a bug I had misdiagnosed.
 *
 * The real bug was in `standardNotation`: it divided by 10^(exponent rounded down
 * to a multiple of three) and then labelled the result with the UNROUNDED
 * exponent. For 1e58 that printed `10e58` -- which denotes 1e59, a different
 * number. The divisor and the label disagreed.
 *
 * So the normalisation here is a guard, not a fix. It is kept because the cost is
 * two comparisons and because the failure mode it protects against -- a mantissa
 * that lands exactly on the tier boundary -- would be a cosmetic setting quietly
 * changing what the player earns.
 */
function normalise(
  value: Decimal,
  base: number
): { mantissa: Decimal; exponent: number } {
  let exponent = Math.floor(value.log10());
  let mantissa = value.div(Decimal.pow(10, exponent));

  const limit = Decimal.fromNumber(base);
  while (mantissa.greaterThanOrEqualTo(limit)) {
    mantissa = mantissa.div(10);
    exponent += 1;
  }
  while (mantissa.lessThan(1) && mantissa.greaterThan(ZERO)) {
    mantissa = mantissa.times(10);
    exponent -= 1;
  }

  return { mantissa, exponent };
}

/** `3.790e9` — mantissa in 1-10, full exponent, unambiguous at any magnitude. */
function standardNotation(value: Decimal, digits: number): string {
  const { mantissa, exponent } = normalise(value, 10);
  return `${trimZeros(mantissa.toPrecision(digits))}e${exponent}`;
}

/**
 * `3.79E9` — exponent forced to a multiple of three.
 *
 * The mantissa therefore always lands in 1-999, which is what makes a column of
 * engineering-notation numbers visually comparable. Standard notation's mantissa
 * drifts across 1-9.99 as the exponent climbs, so digits do not line up.
 */
function engineeringNotation(value: Decimal, digits: number): string {
  const rough = normalise(value, 10);
  // Round the exponent DOWN to a multiple of three so the mantissa cannot fall
  // below 1. Rounding up would make it 1000, which is the next tier's job.
  const exponent = Math.floor(rough.exponent / 3) * 3;
  const mantissa = value.div(Decimal.pow(10, exponent));
  // Two decimals before the exponent leaves room for three significant figures
  // once the exponent's digits are counted, which is the usual convention.
  return `${trimZeros(mantissa.toPrecision(Math.max(2, digits)))}E${exponent}`;
}

/**
 * `3.79B` — short-scale suffixes.
 *
 * Falls back to standard past the last suffix (1e63). That switch is silent, which
 * is the honest argument for the notation setting: nothing is WRONG at 1e60, but
 * `QaDc` is not a word, and the player has no say in it.
 */
function suffixNotation(value: Decimal, digits: number): string {
  const { exponent } = normalise(value, 10);
  const tier = Math.floor(exponent / 3);
  if (tier >= SUFFIXES.length) return standardNotation(value, digits);

  const shifted = value.div(Decimal.pow(1000, tier));
  return trimZeros(shifted.toPrecision(digits)) + SUFFIXES[tier];
}

/** `1.500` -> `1.5`, `1.000` -> `1`, `100` -> `100`. */
function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/**
 * The player's notation preference.
 *
 * Read through a getter that the settings module registers, rather than imported
 * directly. That keeps `formulas.ts` free of any dependency on storage or
 * preferences -- it is a pure formatting library, and the balance simulator (a
 * Node tool with no browser) formats numbers with it.
 */
let notationProvider: () => Notation = () => DEFAULT_NOTATION;

export function setNotationProvider(provider: () => Notation): void {
  notationProvider = provider;
}

function currentNotation(): Notation {
  try {
    return notationProvider();
  } catch {
    // A provider that throws must not take a render down with it. Formatting is
    // cosmetic; falling back to the default is always safe.
    return DEFAULT_NOTATION;
  }
}

/** Compact duration, e.g. `3h 12m`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0s';
  const total = Math.floor(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
