/**
 * Unit tests for the cost/production math.
 *
 * The originals asserted `Decimal.valueOf(15)`-style values; `Decimal.valueOf`
 * is not a break_infinity.js API (it resolves to `Function.prototype.valueOf` and
 * returns the class), which is what produced the four `t.indexOf is not a
 * function` failures. Everything here goes through the game's `dec()` helper so
 * the tests exercise the same construction path as the engine.
 */
import { describe, it, expect } from 'vitest';
import {
  costForNextUnit,
  costForBulkPurchase,
  maxAffordable,
  computeProduction,
  formatDecimal,
  formatDuration,
  effectiveCostGrowth,
  MIN_COST_GROWTH,
} from '../game/formulas';
import { dec, ONE, ZERO } from '../game/decimal';

describe('formulas – cost calculations', () => {
  const baseCost = dec(15);
  const costGrowth = 1.15;

  it('costForNextUnit returns baseCost for the first unit', () => {
    expect(costForNextUnit(baseCost, costGrowth, 0, ONE).toString()).toBe('15');
  });

  it('costForNextUnit applies growth per owned unit', () => {
    // 15 * 1.15^3 = 22.8131...
    expect(Number(costForNextUnit(baseCost, costGrowth, 3, ONE).toString())).toBeCloseTo(22.8131, 3);
  });

  it('costForNextUnit applies the cost discount', () => {
    expect(Number(costForNextUnit(baseCost, costGrowth, 0, dec(0.8)).toString())).toBeCloseTo(12, 6);
  });

  it('costForNextUnit of one unit matches costForBulkPurchase of one unit', () => {
    for (const owned of [0, 1, 5, 37, 250]) {
      expect(costForNextUnit(baseCost, costGrowth, owned, ONE).toString()).toBe(
        costForBulkPurchase(baseCost, costGrowth, owned, 1, ONE).toString()
      );
    }
  });

  it('costForBulkPurchase sums individual costs correctly', () => {
    // 15 + 15*1.15 + 15*1.15^2 = 15 + 17.25 + 19.8375
    const total = costForBulkPurchase(baseCost, costGrowth, 0, 3, ONE);
    expect(Number(total.toString())).toBeCloseTo(52.0875, 3);
  });

  it('costForBulkPurchase equals the sum of the individual next-unit costs', () => {
    let manual = 0;
    for (let i = 0; i < 5; i += 1) {
      manual += Number(costForNextUnit(baseCost, costGrowth, i, ONE).toString());
    }
    const bulk = Number(costForBulkPurchase(baseCost, costGrowth, 0, 5, ONE).toString());
    expect(bulk).toBeCloseTo(manual, 6);
  });

  it('costForBulkPurchase is additive across a split purchase', () => {
    const oneShot = costForBulkPurchase(baseCost, costGrowth, 7, 13, ONE);
    const split =
      costForBulkPurchase(baseCost, costGrowth, 7, 5, ONE).plus(
        costForBulkPurchase(baseCost, costGrowth, 12, 8, ONE)
      );
    expect(Number(oneShot.toString())).toBeCloseTo(Number(split.toString()), 6);
  });

  it('costForBulkPurchase returns zero when count<=0', () => {
    expect(costForBulkPurchase(baseCost, costGrowth, 0, 0, ONE).toString()).toBe('0');
    expect(costForBulkPurchase(baseCost, costGrowth, 0, -1, ONE).toString()).toBe('0');
  });

  it('effectiveCostGrowth clamps so costs can never collapse', () => {
    expect(effectiveCostGrowth(1.15, -0.01)).toBeCloseTo(1.14, 6);
    expect(effectiveCostGrowth(1.15, -5)).toBe(MIN_COST_GROWTH);
  });
});

describe('formulas – maxAffordable', () => {
  const baseCost = dec(10);
  const costGrowth = 1.12;

  it('returns 0 when nothing is affordable', () => {
    expect(maxAffordable(baseCost, costGrowth, 0, ZERO, ONE)).toBe(0);
    expect(maxAffordable(baseCost, costGrowth, 0, dec(9.99), ONE)).toBe(0);
  });

  it('finds exactly as many units as the budget allows', () => {
    for (const owned of [0, 3, 40]) {
      for (const budget of [10, 137.5, 12_345.6, 1e12]) {
        const count = maxAffordable(baseCost, costGrowth, owned, dec(budget), ONE);
        expect(count).toBeGreaterThanOrEqual(0);
        if (count > 0) {
          const cost = costForBulkPurchase(baseCost, costGrowth, owned, count, ONE);
          expect(cost.lessThanOrEqualTo(dec(budget))).toBe(true);
          const nextCost = costForBulkPurchase(baseCost, costGrowth, owned, count + 1, ONE);
          expect(nextCost.greaterThan(dec(budget))).toBe(true);
        }
      }
    }
  });

  it('buying MAX and then one more is never affordable', () => {
    const budget = dec(50_000);
    const count = maxAffordable(baseCost, costGrowth, 12, budget, ONE);
    expect(count).toBeGreaterThan(0);
    expect(costForBulkPurchase(baseCost, costGrowth, 12, count, ONE).lessThanOrEqualTo(budget)).toBe(true);
    expect(costForBulkPurchase(baseCost, costGrowth, 12, count + 1, ONE).greaterThan(budget)).toBe(true);
  });
});

describe('formulas – production', () => {
  it('multiplies rate * owned * perGenerator * perResource * global', () => {
    const prod = computeProduction(dec(2.5), 4, dec(1.2), dec(1.1), dec(1.35));
    // 2.5 * 4 * 1.2 * 1.1 * 1.35 = 17.82
    expect(Number(prod.toString())).toBeCloseTo(17.82, 2);
  });

  it('returns zero when nothing is owned', () => {
    expect(computeProduction(dec(5), 0, ONE, ONE, ONE).toString()).toBe('0');
  });
});

describe('formulas – formatting', () => {
  it('handles zero, small and round numbers', () => {
    expect(formatDecimal(ZERO)).toBe('0');
    expect(formatDecimal(dec(0.5))).toBe('0.5');
    expect(formatDecimal(dec(42))).toBe('42');
    expect(formatDecimal(dec(1000))).toBe('1K');
  });

  it('uses short-scale suffixes', () => {
    expect(formatDecimal(dec(1_500_000))).toBe('1.5M');
    expect(formatDecimal(dec(2.5e12))).toBe('2.5T');
    expect(formatDecimal(dec(1e100))).toMatch(/e\+100$/);
  });

  it('handles negatives and NaN safely', () => {
    expect(formatDecimal(dec(-1500))).toBe('-1.5K');
    expect(formatDecimal(dec(Number.NaN))).toBe('—');
  });

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3_700)).toBe('1h 1m');
    expect(formatDuration(90_000)).toBe('1d 1h');
  });
});
