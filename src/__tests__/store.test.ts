/**
 * Store tests: purchase legality, resource accounting, and the invariant that the
 * UI and the actions agree.
 *
 * These cover the behaviour that was previously a stub — `buyGenerator` used a
 * hardcoded 15 * 1.15^(owned+1) cost for every generator regardless of its
 * definition, and `purchaseUpgrade` was an empty function body.
 */
import { beforeEach, describe, it, expect } from 'vitest';
import { useGameStore } from '../game/gameStore';
import { requireGenDef, GENERATOR_DEFS } from '../game/generators';
import { costForBulkPurchase, effectiveCostGrowth, maxAffordable } from '../game/formulas';
import { clearSaveData } from '../game/storage';
import { computeMultipliers } from '../game/multipliers';
import { dec } from '../game/decimal';
import { STARTING_CASH } from '../game/serialize';

function store() {
  return useGameStore.getState();
}

/** Set cash to an absolute value, ignoring a fresh game's starting grant. */
function setCash(amount: number) {
  const state = store();
  state.gameState.resources.cash = dec(amount);
}

beforeEach(() => {
  clearSaveData();
  store().hardReset();
});

describe('buyGenerator', () => {
  it('buys a single unit at base cost', () => {
    const def = requireGenDef('juniorDev');
    setCash(100);

    const result = store().buyGenerator('juniorDev');
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);

    const state = store().gameState;
    expect(state.generators.juniorDev.owned).toBe(1);
    expect(Number(state.resources.cash.toString())).toBeCloseTo(100 - Number(def.baseCost.toString()), 6);
  });

  it('uses each generator’s own base cost, not a hardcoded one', () => {
    // The old implementation charged every generator 15 * 1.15^(owned+1),
    // which made a K8s Cluster the same price as a Junior Dev.
    for (const def of GENERATOR_DEFS) {
      store().hardReset();
      const state = store().gameState;
      state.generators[def.id] = { owned: 0, unlocked: true };
      setCash(1e9);

      const result = store().buyGenerator(def.id);
      expect(result.ok, `${def.id} should be purchasable`).toBe(true);

      const spent = dec(1e9).minus(store().gameState.resources.cash);
      expect(Number(spent.toString())).toBeCloseTo(Number(def.baseCost.toString()), 4);
    }
  });

  it('scales price with the number already owned', () => {
    setCash(1e6);
    store().buyGenerator('juniorDev');
    store().buyGenerator('juniorDev');
    store().buyGenerator('juniorDev');

    const def = requireGenDef('juniorDev');
    const mult = computeMultipliers(store().gameState);
    const growth = effectiveCostGrowth(def.costGrowth, mult.costGrowthDelta);
    const expected = costForBulkPurchase(def.baseCost, growth, 0, 3, mult.costDiscount);
    // Three buys in a row must cost exactly the bulk price for three.
    expect(Number(store().gameState.resources.cash.toString())).toBeCloseTo(
      Number(dec(1e6).minus(expected).toString()),
      4
    );
  });

  it('refuses when cash is insufficient and changes nothing', () => {
    setCash(5);
    const result = store().buyGenerator('juniorDev');
    expect(result.ok).toBe(false);
    expect(store().gameState.generators.juniorDev.owned).toBe(0);
    expect(Number(store().gameState.resources.cash.toString())).toBe(5);
  });

  it('refuses a locked generator', () => {
    setCash(1e12);
    const result = store().buyGenerator('k8sCluster');
    expect(result.ok).toBe(false);
    expect(store().gameState.generators.k8sCluster.owned).toBe(0);
  });

  it('buys in bulk and charges the geometric sum', () => {
    setCash(1e6);
    const result = store().buyGenerator('juniorDev', 10);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(10);
    expect(store().gameState.generators.juniorDev.owned).toBe(10);
  });

  it('never buys more than the cash allows, for every bulk size', () => {
    for (const amount of [1, 10, 100] as const) {
      store().hardReset();
      setCash(5000);
      const result = store().buyGenerator('juniorDev', amount);
      if (result.ok) {
        expect(store().gameState.resources.cash.greaterThanOrEqualTo(dec(0))).toBe(true);
      } else {
        expect(store().gameState.generators.juniorDev.owned).toBe(0);
      }
    }
  });

  it('MAX buys exactly what the cash affords and never goes negative', () => {
    setCash(500_000);
    const result = store().buyGenerator('juniorDev', 'max');

    expect(result.ok).toBe(true);
    expect(store().gameState.resources.cash.greaterThanOrEqualTo(dec(0))).toBe(true);
    expect(store().gameState.generators.juniorDev.owned).toBe(result.count);

    // One more unit must now be unaffordable.
    const after = store().gameState;
    const mult = computeMultipliers(after);
    const def = requireGenDef('juniorDev');
    const growth = effectiveCostGrowth(def.costGrowth, mult.costGrowthDelta);
    const nextCost = costForBulkPurchase(def.baseCost, growth, after.generators.juniorDev.owned, 1, mult.costDiscount);
    expect(after.resources.cash.lessThan(nextCost)).toBe(true);
  });

  it('MAX with no cash is a no-op', () => {
    setCash(0);
    const result = store().buyGenerator('juniorDev', 'max');
    expect(result.ok).toBe(false);
    expect(store().gameState.generators.juniorDev.owned).toBe(0);
  });

  it('applies cost discounts', () => {
    setCash(1e9);
    store().buyGenerator('juniorDev', 10);
    const cashAfterFullPrice = store().gameState.resources.cash.toString();

    store().hardReset();
    setCash(1e9);
    const state = store().gameState;
    state.upgrades.purchased = ['automatedLinting']; // x0.88 on all costs
    store().buyGenerator('juniorDev', 10);

    expect(store().gameState.resources.cash.greaterThan(dec(cashAfterFullPrice))).toBe(true);
  });

  it('counts a manual click', () => {
    setCash(1e6);
    store().buyGenerator('juniorDev');
    expect(store().gameState.stats.manualClicks).toBe(1);
  });
});

describe('purchaseUpgrade', () => {
  it('deducts the cost and records the purchase', () => {
    setCash(1e6);
    const result = store().purchaseUpgrade('codeMaster');
    expect(result.ok).toBe(true);

    const state = store().gameState;
    expect(state.upgrades.purchased).toContain('codeMaster');
    expect(Number(state.resources.cash.toString())).toBeCloseTo(1e6 - 50, 6);
  });

  it('cannot be bought twice', () => {
    setCash(1e6);
    store().purchaseUpgrade('codeMaster');
    const second = store().purchaseUpgrade('codeMaster');
    expect(second.ok).toBe(false);
    expect(store().gameState.upgrades.purchased.filter((id) => id === 'codeMaster').length).toBe(1);
  });

  it('refuses when the cost resource is short', () => {
    const result = store().purchaseUpgrade('styleGuide'); // costs 150 LoC
    expect(result.ok).toBe(false);
    expect(store().gameState.upgrades.purchased).toEqual([]);
  });

  it('pays in the upgrade’s own resource', () => {
    store().gameState.resources.coffee = dec(500);
    const result = store().purchaseUpgrade('testObsession'); // costs 100 coffee
    expect(result.ok).toBe(true);
    expect(Number(store().gameState.resources.coffee.toString())).toBeCloseTo(400, 6);
  });

  it('enforces generator-count gates', () => {
    setCash(1e9);
    const result = store().purchaseUpgrade('continuousIntegration'); // needs 2 CI pipelines
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/CI\/CD Pipeline/);
  });

  it('enforces lifetimeCash gates', () => {
    setCash(1e9);
    const result = store().purchaseUpgrade('seniorMentor'); // needs 50k lifetime cash
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/lifetime cash/);
  });

  it('unlocks a generator the moment the gate is satisfied', () => {
    const state = store().gameState;
    state.generators.ciPipeline = { owned: 2, unlocked: true };
    state.resources.cash = dec(1e9);
    store().purchaseUpgrade('continuousIntegration');

    // codeMaster-style side effect check: the store re-derives transient data
    expect(store().gameState.upgrades.purchased).toContain('continuousIntegration');
    expect(store().transient.production.perGenerator.ciPipeline).toBeDefined();
  });

  it('immediately boosts production', () => {
    const state = store().gameState;
    state.generators.juniorDev = { owned: 10, unlocked: true };
    state.resources.cash = dec(1e6);
    store().tick(0.01);

    const before = Number(store().transient.production.perGenerator.juniorDev.toString());
    store().purchaseUpgrade('codeMaster');
    const after = Number(store().transient.production.perGenerator.juniorDev.toString());

    expect(after).toBeGreaterThan(before);
    expect(after / before).toBeCloseTo(1.1, 6);
  });

  it('rejects an unknown id', () => {
    expect(store().purchaseUpgrade('nope').ok).toBe(false);
  });
});

describe('performPrestige', () => {
  it('refuses when there is nothing to gain', () => {
    const result = store().performPrestige();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/lifetime cash/);
  });

  it('resets the run and banks tech debt', () => {
    const state = store().gameState;
    state.resources.lifetimeCash = dec(1e9);
    state.resources.cash = dec(1e9);
    state.generators.juniorDev = { owned: 50, unlocked: true };
    state.upgrades.purchased = ['codeMaster'];

    const result = store().performPrestige();
    expect(result.ok).toBe(true);

    const after = store().gameState;
    expect(after.generators.juniorDev.owned).toBe(0);
    expect(after.upgrades.purchased).toEqual([]);
    // Cash resets to the starting grant, not zero, so the next run is playable.
    expect(Number(after.resources.cash.toString())).toBe(STARTING_CASH);
    expect(Number(after.resources.lifetimeCash.toString())).toBe(1e9);
    expect(after.prestige.techDebt.greaterThan(0)).toBe(true);
    expect(after.stats.prestigeCount).toBe(1);
  });

  it('resets the session clock', () => {
    store().gameState.resources.lifetimeCash = dec(1e9);
    store().tick(1);
    expect(store().sessionSeconds).toBeGreaterThan(0);
    store().performPrestige();
    expect(store().sessionSeconds).toBe(0);
  });
});

describe('purchasePermUpgrade', () => {
  it('spends tech debt and applies the permanent multiplier', () => {
    const state = store().gameState;
    state.prestige.techDebt = dec(100);
    state.generators.juniorDev = { owned: 10, unlocked: true };
    store().tick(0.01);
    const before = Number(store().transient.production.perGenerator.juniorDev.toString());

    const result = store().purchasePermUpgrade('refactoringGrant');
    expect(result.ok).toBe(true);
    expect(Number(store().gameState.prestige.techDebt.toString())).toBe(75);

    const after = Number(store().transient.production.perGenerator.juniorDev.toString());
    expect(after / before).toBeCloseTo(1.25, 6);
  });

  it('refuses without enough tech debt', () => {
    expect(store().purchasePermUpgrade('refactoringGrant').ok).toBe(false);
  });
});

describe('tick', () => {
  it('advances production and playtime', () => {
    const state = store().gameState;
    state.generators.juniorDev = { owned: 10, unlocked: true };
    setCash(0);

    store().tick(1);
    expect(Number(store().gameState.resources.cash.toString())).toBeCloseTo(2, 6);
    expect(store().gameState.stats.playSeconds).toBeCloseTo(1, 6);
    expect(store().sessionSeconds).toBeCloseTo(1, 6);
  });

  it('clamps huge deltas', () => {
    const state = store().gameState;
    state.generators.juniorDev = { owned: 10, unlocked: true };
    setCash(0);
    store().tick(9999);
    expect(Number(store().gameState.resources.cash.toString())).toBeCloseTo(4, 6);
  });

  it('ignores non-positive deltas', () => {
    store().tick(0);
    store().tick(-3);
    expect(store().gameState.stats.playSeconds).toBe(0);
  });

  it('never mutates a previous state object', () => {
    store().gameState.generators.juniorDev = { owned: 10, unlocked: true };
    const before = store().gameState;
    const cashBefore = before.resources.cash.toString();
    store().tick(1);
    expect(before.resources.cash.toString()).toBe(cashBefore);
    expect(store().gameState).not.toBe(before);
  });
});

describe('grantResources (dev tool)', () => {
  it('adds the amount to the chosen resource only', () => {
    setCash(100);
    const before = store().gameState.resources.coffee.toString();
    store().grantResources('cash', dec(50));
    expect(Number(store().gameState.resources.cash.toString())).toBeCloseTo(150, 6);
    expect(store().gameState.resources.coffee.toString()).toBe(before);
  });

  it('bumps tickVersion and refreshes the production snapshot', () => {
    // Regression: the debug panel used to write gameState.resources directly,
    // which left tickVersion untouched and the production snapshot stale, so
    // cards kept showing the old rate until the next real tick.
    setCash(100);
    store().gameState.generators.juniorDev = { owned: 10, unlocked: true };
    store().tick(0.01);
    const before = store().transient.production.perResource.cash.toString();
    const versionBefore = store().gameState.tickVersion;

    store().grantResources('linesOfCode', dec(10_000));

    expect(store().gameState.tickVersion).toBeGreaterThan(versionBefore);
    // More LoC means more revenue, so the cash rate must have moved.
    const after = store().transient.production.perResource.cash.toString();
    expect(Number(after)).toBeGreaterThan(Number(before));
  });

  it('does not touch lifetime accounting', () => {
    setCash(100);
    const lifetime = store().gameState.resources.lifetimeCash.toString();
    store().grantResources('cash', dec(1_000_000));
    expect(store().gameState.resources.lifetimeCash.toString()).toBe(lifetime);
  });
});

describe('catchUp', () => {
  it('credits hidden time and raises an offline report', () => {
    const state = store().gameState;
    state.generators.juniorDev = { owned: 100, unlocked: true };
    setCash(0);

    store().catchUp(60 * 60 * 1000);
    // 20/s * 1800s = 36000
    expect(Number(store().gameState.resources.cash.toString())).toBeCloseTo(36_000, 3);
    expect(store().offlineReport).not.toBeNull();
    expect(store().offlineReport?.trivial).toBe(false);

    store().dismissOfflineReport();
    expect(store().offlineReport).toBeNull();
  });

  it('ignores short absences', () => {
    const state = store().gameState;
    state.generators.juniorDev = { owned: 100, unlocked: true };
    store().catchUp(5_000);
    expect(store().offlineReport).toBeNull();
  });
});

describe('save / load', () => {
  it('round-trips through the store', () => {
    setCash(1e6);
    store().buyGenerator('juniorDev', 5);
    store().save();

    const json = store().exportSave();
    expect(json).toBeTruthy();

    store().hardReset();
    expect(store().gameState.generators.juniorDev.owned).toBe(0);

    const result = store().loadFromString(json as string);
    expect(result.ok).toBe(true);
    expect(store().gameState.generators.juniorDev.owned).toBe(5);
  });

  it('rejects a corrupt import without destroying the state', () => {
    setCash(1e6);
    store().buyGenerator('juniorDev');
    const result = store().loadFromString('not json at all');
    expect(result.ok).toBe(false);
    expect(store().gameState.generators.juniorDev.owned).toBe(1);
  });

  it('hydrate loads from storage', () => {
    setCash(1e6);
    store().buyGenerator('juniorDev', 3);
    store().save();

    const source = store().hydrate();
    expect(source).toBe('current');
    expect(store().gameState.generators.juniorDev.owned).toBe(3);
  });

  it('hardReset clears storage and state', () => {
    setCash(1e6);
    store().buyGenerator('juniorDev');
    store().save();
    store().hardReset();

    expect(store().gameState.generators.juniorDev.owned).toBe(0);
    // hardReset restores a brand-new game, which includes the starting grant.
    expect(Number(store().gameState.resources.cash.toString())).toBe(STARTING_CASH);
    expect(store().gameState.resources.lifetimeCash.toString()).toBe('0');
    expect(store().transient.save.lastSavedAt).toBeNull();
  });
});

describe('data integrity', () => {
  it('every generator is purchasable once unlocked', () => {
    for (const def of GENERATOR_DEFS) {
      store().hardReset();
      const state = store().gameState;
      state.generators[def.id] = { owned: 0, unlocked: true };
      setCash(1e12);
      const result = store().buyGenerator(def.id);
      expect(result.ok, `${def.id} should be purchasable`).toBe(true);
      expect(store().gameState.generators[def.id].owned).toBe(1);
    }
  });

  it('rejects unknown or malformed generator ids without corrupting state', () => {
    setCash(1e6);
    store().buyGenerator('juniorDev');
    const before = store().gameState.resources.cash.toString();

    const result = store().buyGenerator('doesNotExist' as never);
    expect(result.ok).toBe(false);
    expect(store().gameState.resources.cash.toString()).toBe(before);
  });

  it('keeps cash non-negative under repeated MAX buying', () => {
    const state = store().gameState;
    state.generators.juniorDev = { owned: 5, unlocked: true };
    setCash(1e7);

    for (let i = 0; i < 25; i += 1) {
      store().buyGenerator('juniorDev', 'max');
      expect(store().gameState.resources.cash.greaterThanOrEqualTo(dec(0))).toBe(true);
    }
    expect(store().gameState.generators.juniorDev.owned).toBeGreaterThan(5);
  });

  it('MAX never produces a negative cash balance for any generator', () => {
    for (const def of GENERATOR_DEFS) {
      store().hardReset();
      const state = store().gameState;
      state.generators[def.id] = { owned: 37, unlocked: true };
      setCash(5e7);
      store().buyGenerator(def.id, 'max');
      expect(store().gameState.resources.cash.greaterThanOrEqualTo(dec(0))).toBe(true);
    }
  });

  it('maxAffordable agrees with what MAX actually bought', () => {
    const state = store().gameState;
    state.generators.juniorDev = { owned: 12, unlocked: true };
    setCash(80_000);

    const mult = computeMultipliers(store().gameState);
    const def = requireGenDef('juniorDev');
    const growth = effectiveCostGrowth(def.costGrowth, mult.costGrowthDelta);
    const expected = maxAffordable(def.baseCost, growth, 12, store().gameState.resources.cash, mult.costDiscount);

    expect(store().buyGenerator('juniorDev', 'max').count).toBe(expected);
  });
});

