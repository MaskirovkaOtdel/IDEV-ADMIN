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

/** Round to `digits` significant figures and render with a short-scale suffix. */
export function formatDecimal(value: Decimal, digits = 3): string {
  if (isNaNDecimal(value)) return '—';
  if (value.eq(ZERO)) return '0';
  if (value.lt(ZERO)) return '-' + formatDecimal(value.negate(), digits);

  // Below 1000 show plain decimals (trimmed).
  if (value.lt(1000)) {
    const fixed = value.toFixed(2);
    return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  }

  const exponent = value.exponent;              // value = mantissa * 10^exponent
  const tier = Math.floor(exponent / 3);
  if (tier >= SUFFIXES.length) {
    return value.toExponential(2);             // falls back to 1.23e+45 style
  }

  const shifted = value.div(Decimal.pow(1000, tier));
  let text = shifted.toPrecision(digits);
  if (text.includes('e')) text = shifted.toFixed(digits);
  if (text.includes('.')) text = text.replace(/\.?0+$/, '');
  return text + SUFFIXES[tier];
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
