/**
 * Tests for the multiplier model.
 *
 * The previous implementation multiplied every upgrade's raw `value` into the
 * global multiplier regardless of `kind`, so a 12%-off discount (0.88) became a
 * global production penalty and "+1%" style values shrank production instead of
 * raising it. These tests pin the correct per-kind behaviour.
 */
import { describe, it, expect } from 'vitest';
import { computeMultipliers } from '../game/multipliers';
import { UPGRADE_DEFS, upgradeDef } from '../game/upgrades';
import { PERM_UPGRADE_DEFS } from '../game/permUpgrades';
import { createInitialState } from '../game/serialize';
import { ONE } from '../game/decimal';
import type { GameState } from '../game/types';

function withUpgrades(...ids: string[]): GameState {
  const state = createInitialState();
  state.upgrades.purchased = ids.filter((id) => upgradeDef(id));
  return state;
}

describe('computeMultipliers – baseline', () => {
  it('is all ones with nothing purchased', () => {
    const mult = computeMultipliers(createInitialState());
    expect(mult.global.toString()).toBe('1');
    expect(mult.costDiscount.toString()).toBe('1');
    expect(mult.revenueMult.toString()).toBe('1');
    expect(mult.costGrowthDelta).toBe(0);
    expect(mult.perResource.cash.toString()).toBe('1');
    expect(mult.perGenerator.juniorDev.toString()).toBe('1');
  });
});

describe('computeMultipliers – per-kind handling', () => {
  it('globalMult multiplies production, never cost', () => {
    const mult = computeMultipliers(withUpgrades('codeMaster'));
    expect(Number(mult.global.toString())).toBeCloseTo(1.1, 6);
    expect(mult.costDiscount.toString()).toBe('1');
  });

  it('costDiscount only touches costDiscount', () => {
    const mult = computeMultipliers(withUpgrades('automatedLinting'));
    expect(mult.global.toString()).toBe('1');
    expect(Number(mult.costDiscount.toString())).toBeCloseTo(0.88, 6);
  });

  it('a discount makes things cheaper, never less productive', () => {
    const mult = computeMultipliers(withUpgrades('automatedLinting'));
    expect(mult.global.greaterThanOrEqualTo(ONE)).toBe(true);
    expect(mult.costDiscount.lessThan(ONE)).toBe(true);
  });

  it('a discount makes a purchase strictly cheaper', () => {
    const plain = computeMultipliers(createInitialState()).costDiscount;
    const discounted = computeMultipliers(withUpgrades('automatedLinting')).costDiscount;
    expect(discounted.lessThan(plain)).toBe(true);
  });

  it('generatorMult lands on the generator, not on a resource', () => {
    const mult = computeMultipliers(withUpgrades('quantumServer'));
    expect(Number(mult.perGenerator.k8sCluster.toString())).toBeCloseTo(3, 6);
    // A generator id must never be looked up in the resource table (this used to
    // throw `Cannot read properties of undefined (reading 'times')`).
    for (const value of Object.values(mult.perResource)) {
      expect(value.toString()).toBe('1');
    }
  });

  it('resourceMult lands on the resource', () => {
    const mult = computeMultipliers(withUpgrades('styleGuide', 'testObsession'));
    expect(Number(mult.perResource.linesOfCode.toString())).toBeCloseTo(1.25, 6);
    expect(Number(mult.perResource.coffee.toString())).toBeCloseTo(1.3, 6);
    expect(mult.perResource.cash.toString()).toBe('1');
  });

  it('revenueMult is separate from global production', () => {
    const mult = computeMultipliers(withUpgrades('freelanceContracts'));
    expect(Number(mult.revenueMult.toString())).toBeCloseTo(1.5, 6);
    expect(mult.global.toString()).toBe('1');
  });

  it('costGrowthDelta is additive and negative', () => {
    const mult = computeMultipliers(withUpgrades('refactorBot'));
    expect(mult.costGrowthDelta).toBeCloseTo(-0.01, 6);
  });

  it('multipliers stack multiplicatively across upgrades', () => {
    const mult = computeMultipliers(withUpgrades('codeMaster', 'aiCopilot', 'autonomousAgent'));
    expect(Number(mult.global.toString())).toBeCloseTo(1.1 * 1.35 * 1.25, 6);
  });

  it('a single upgrade can carry several effects', () => {
    const mult = computeMultipliers(withUpgrades('automatedLinting'));
    expect(Number(mult.perGenerator.linter.toString())).toBeCloseTo(2, 6);
    expect(Number(mult.costDiscount.toString())).toBeCloseTo(0.88, 6);
  });

  it('every upgrade effect kind is handled', () => {
    const handled = new Set(['globalMult', 'resourceMult', 'generatorMult', 'revenueMult', 'costDiscount', 'costGrowthDelta']);
    for (const def of UPGRADE_DEFS) {
      for (const effect of def.effects) {
        expect(handled.has(effect.kind)).toBe(true);
        expect(Number.isFinite(effect.value)).toBe(true);
        if (effect.kind === 'costDiscount' || effect.kind === 'costGrowthDelta') {
          expect(effect.value).toBeLessThan(1);
        } else {
          expect(effect.value).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});

describe('computeMultipliers – permanent (prestige) upgrades', () => {
  it('permanent upgrades raise global production', () => {
    const state = createInitialState();
    state.prestige.permanentUpgrades = { refactoringGrant: 2 };
    const mult = computeMultipliers(state);
    expect(Number(mult.global.toString())).toBeCloseTo(1.25 * 1.25, 6);
  });

  it('permanent upgrades can discount generator costs', () => {
    const state = createInitialState();
    state.prestige.permanentUpgrades = { vcBacking: 1 };
    const mult = computeMultipliers(state);
    expect(Number(mult.costDiscount.toString())).toBeCloseTo(0.9, 6);
  });

  it('stacks with run upgrades', () => {
    const state = withUpgrades('codeMaster');
    state.prestige.permanentUpgrades = { refactoringGrant: 1 };
    const mult = computeMultipliers(state);
    expect(Number(mult.global.toString())).toBeCloseTo(1.1 * 1.25, 6);
  });

  it('every permanent upgrade grants a multiplier above 1', () => {
    for (const def of PERM_UPGRADE_DEFS) {
      expect(def.globalMult).toBeGreaterThan(1);
      expect(def.costMultiplier).toBeGreaterThan(1);
      expect(def.baseCost.greaterThan(0)).toBe(true);
    }
  });
});
