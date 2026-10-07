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
import { PERM_UPGRADE_DEFS, permUpgradeDef } from '../game/permUpgrades';
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

  it('applies per-generator permanent effects only to their target', () => {
    const state = createInitialState();
    state.prestige.permanentUpgrades = { seniorArchitect: 1 };
    const mult = computeMultipliers(state);
    // seniorArchitect doubles juniorDev and seniorDev, nothing else.
    expect(Number(mult.perGenerator.juniorDev.toString())).toBeCloseTo(2, 6);
    expect(Number(mult.perGenerator.seniorDev.toString())).toBeCloseTo(2, 6);
    expect(mult.perGenerator.codeReview.toString()).toBe('1');
    expect(mult.perGenerator.k8sCluster.toString()).toBe('1');
    // A generator target must never leak into the resource table.
    for (const value of Object.values(mult.perResource)) {
      expect(value.toString()).toBe('1');
    }
  });

  it('stacks permanent levels multiplicatively', () => {
    const one = createInitialState();
    one.prestige.permanentUpgrades = { refactoringGrant: 1 };
    const three = createInitialState();
    three.prestige.permanentUpgrades = { refactoringGrant: 3 };
    expect(Number(computeMultipliers(three).global.toString())).toBeCloseTo(
      Math.pow(1.25, 3),
      6
    );
    expect(Number(computeMultipliers(one).global.toString())).toBeCloseTo(1.25, 6);
  });

  it('permanent cost growth reduction is additive per level', () => {
    const state = createInitialState();
    state.prestige.permanentUpgrades = { legacyCodebase: 3 };
    expect(computeMultipliers(state).costGrowthDelta).toBeCloseTo(-0.03, 6);
  });

  it('applies offline efficiency from permanent upgrades only', () => {
    const state = createInitialState();
    expect(computeMultipliers(state).offlineEfficiency.toString()).toBe('1');

    // onCallRotation doubles offline efficiency: 50% base becomes 100%.
    state.prestige.permanentUpgrades = { onCallRotation: 1 };
    expect(Number(computeMultipliers(state).offlineEfficiency.toString())).toBeCloseTo(2, 6);

    state.prestige.permanentUpgrades = { onCallRotation: 2 };
    expect(Number(computeMultipliers(state).offlineEfficiency.toString())).toBeCloseTo(4, 6);
  });

  it('stacks with run upgrades', () => {
    const state = withUpgrades('codeMaster');
    state.prestige.permanentUpgrades = { refactoringGrant: 1 };
    const mult = computeMultipliers(state);
    expect(Number(mult.global.toString())).toBeCloseTo(1.1 * 1.25, 6);
  });

  it('every permanent upgrade is well formed', () => {
    for (const def of PERM_UPGRADE_DEFS) {
      expect(def.costMultiplier).toBeGreaterThan(1);
      expect(def.baseCost.greaterThan(0)).toBe(true);
      expect(def.effects.length).toBeGreaterThan(0);
      for (const effect of def.effects) {
        expect(Number.isFinite(effect.value)).toBe(true);
        // Cost-affecting effects must be below 1; production-affecting above 1.
        if (effect.kind === 'costDiscount') {
          expect(effect.value).toBeLessThan(1);
        } else if (effect.kind === 'costGrowthDelta') {
          expect(effect.value).toBeLessThan(0);
        } else {
          expect(effect.value).toBeGreaterThan(1);
        }
        if (effect.kind === 'generatorMult' || effect.kind === 'resourceMult') {
          expect(effect.target).toBeTruthy();
        }
      }
    }
  });

  it('permanent upgrade ids are unique', () => {
    expect(new Set(PERM_UPGRADE_DEFS.map((u) => u.id)).size).toBe(PERM_UPGRADE_DEFS.length);
  });

  it('permanent costs form an ascending ladder when sorted', () => {
    // The pool is grouped by effect kind for readability, not by cost, so
    // ordering in the array is not a cost ordering. What matters is that the
    // player always has a cheaper option available than an expensive one.
    const costs = PERM_UPGRADE_DEFS.map((u) => Number(u.baseCost.toString())).sort((a, b) => a - b);
    expect(new Set(costs).size).toBe(costs.length);
    expect(costs.length).toBeGreaterThan(10);
    expect(costs[0]).toBeLessThan(costs[costs.length - 1]);
  });

  it('offers a permanent option at several price points', () => {
    // A player with a small Tech Debt bank must always have something to buy,
    // otherwise the layer stalls between prestiges.
    const costs = PERM_UPGRADE_DEFS.map((u) => Number(u.baseCost.toString()));
    expect(costs.filter((c) => c <= 200).length).toBeGreaterThanOrEqual(3);
    expect(costs.filter((c) => c >= 25_000).length).toBeGreaterThanOrEqual(2);
  });

  it('permanent pool spans more than one effect kind', () => {
    // This is the whole point of the expansion: if every entry were a global
    // multiplier, the layer would be one number getting larger rather than a
    // progression.
    const kinds = new Set(PERM_UPGRADE_DEFS.flatMap((u) => u.effects.map((e) => e.kind)));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
  });

  it('preserves the original five permanent upgrades for existing saves', () => {
    // These ids, costs and effects are what live saves already reference.
    const legacy: Record<string, { cost: number; global?: number; costMult?: number }> = {
      refactoringGrant: { cost: 25, global: 1.25 },
      openSourceSponsor: { cost: 120, global: 1.25, costMult: 0.95 },
      vcBacking: { cost: 600, global: 1.3, costMult: 0.9 },
      aiSwarmLicense: { cost: 3_000, global: 1.4, costMult: 0.85 },
      timeLoop: { cost: 25_000, global: 1.75, costMult: 0.75 },
    };
    for (const [id, expected] of Object.entries(legacy)) {
      const def = permUpgradeDef(id);
      expect(def, `${id} must still exist`).toBeDefined();
      expect(Number(def!.baseCost.toString())).toBe(expected.cost);
      if (expected.global !== undefined) {
        const global = def!.effects.find((e) => e.kind === 'globalMult');
        expect(global?.value).toBe(expected.global);
      }
      if (expected.costMult !== undefined) {
        const discount = def!.effects.find((e) => e.kind === 'costDiscount');
        expect(discount?.value).toBe(expected.costMult);
      }
    }
  });
});
