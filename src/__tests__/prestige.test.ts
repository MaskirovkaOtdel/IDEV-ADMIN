/**
 * Prestige system tests: the payout curve, what survives a reset, and permanent
 * upgrade purchases.
 *
 * The previous curve paid `log10(lifetimeCash + 1) * 10`, which handed out 10
 * Tech Debt for 10 lifetime cash — the first permanent upgrade was free within a
 * minute — and `purchasePermUpgrade` incremented the run counter as a side effect.
 */
import { describe, it, expect } from 'vitest';
import {
  computeTechDebtGained,
  techDebtForLifetimeCash,
  lifetimeCashForTechDebt,
  resetForPrestige,
  purchasePermUpgrade,
  canPrestige,
  runLifetimeCash,
  estimatePrestigeMilestones,
  CURRENT_SAVE_VERSION,
} from '../game/prestige';
import { permanentGlobalMult, permUpgradeCost, PERM_UPGRADE_DEFS } from '../game/permUpgrades';
import { computeMultipliers } from '../game/multipliers';
import { engineTick } from '../game/engine';
import { createInitialState } from '../game/serialize';
import { GENERATOR_DEFS } from '../game/generators';
import { dec, isNaNDecimal, ZERO } from '../game/decimal';
import { STARTING_CASH } from '../game/serialize';
import type { GameState, PermUpgradeDef } from '../game/types';

function withLifetimeCash(cash: number | string): GameState {
  const state = createInitialState();
  state.resources.lifetimeCash = dec(cash as number);
  state.prestige.baselineLifetimeCash = ZERO;
  return state;
}

describe('computeTechDebtGained – curve', () => {
  it('awards nothing below the 1e3 threshold', () => {
    expect(computeTechDebtGained(withLifetimeCash(0)).toString()).toBe('0');
    expect(computeTechDebtGained(withLifetimeCash(999)).toString()).toBe('0');
    expect(computeTechDebtGained(withLifetimeCash(1e3)).toString()).toBe('0');
  });

  it('awards nothing for a brand-new game', () => {
    expect(canPrestige(createInitialState())).toBe(false);
  });

  it('grows with lifetime cash', () => {
    const values = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e12];
    const payouts = values.map((cash) => Number(computeTechDebtGained(withLifetimeCash(cash)).toString()));
    for (let i = 1; i < payouts.length; i += 1) {
      expect(payouts[i]).toBeGreaterThan(payouts[i - 1]);
    }
  });

  it('hits the documented first-prestige window at 1e7 lifetime cash', () => {
    // The tuning target: ~1 hour of play should bank enough for the first tier (25).
    const payout = Number(computeTechDebtGained(withLifetimeCash(1e7)).toString());
    expect(payout).toBeGreaterThanOrEqual(25);
    expect(payout).toBeLessThan(80);
  });

  it('is monotonic and never NaN/Infinity, even at absurd magnitudes', () => {
    for (const cash of ['1e300', '1e1000', '1e5000']) {
      const payout = computeTechDebtGained(withLifetimeCash(cash));
      expect(isNaNDecimal(payout)).toBe(false);
      expect(payout.toString()).not.toContain('NaN');
      expect(payout.toString()).not.toContain('Infinity');
      expect(payout.greaterThan(0)).toBe(true);
    }
  });

  it('handles a negative lifetime cash defensively', () => {
    const state = createInitialState();
    state.resources.lifetimeCash = dec(-500);
    expect(computeTechDebtGained(state).toString()).toBe('0');
  });
});

describe('prestige curve – inverse functions', () => {
  it('lifetimeCashForTechDebt round-trips through techDebtForLifetimeCash', () => {
    for (const debt of [1, 5, 25, 100, 1000]) {
      const cash = lifetimeCashForTechDebt(debt);
      const back = techDebtForLifetimeCash(cash);
      // Floor makes the round-trip exact to within one order-of-magnitude step.
      expect(Number(back.toString())).toBeGreaterThanOrEqual(debt - 1);
    }
  });

  it('publishes the reference table used by the modal', () => {
    const table = estimatePrestigeMilestones();
    expect(table.length).toBeGreaterThan(3);
    for (const row of table) {
      expect(Number(row.techDebt)).toBeGreaterThan(0);
    }
  });

  it('the first tier is reachable but not trivial', () => {
    const firstTier: PermUpgradeDef = PERM_UPGRADE_DEFS[0];
    const needed = Number(lifetimeCashForTechDebt(Number(firstTier.baseCost.toString())).toString());
    expect(needed).toBeGreaterThan(1e5);
    expect(needed).toBeLessThan(1e9);
  });
});

describe('resetForPrestige', () => {
  function richState(): GameState {
    const state = createInitialState();
    state.resources.cash = dec(5000);
    state.resources.linesOfCode = dec(999);
    state.resources.coffee = dec(7);
    state.resources.lifetimeCash = dec(1e8);
    state.generators.juniorDev = { owned: 40, unlocked: true };
    state.generators.k8sCluster = { owned: 2, unlocked: true };
    state.upgrades.purchased = ['codeMaster', 'styleGuide'];
    state.stats.playSeconds = 3600;
    state.stats.totalCashEarned = dec(1e8);
    state.stats.totalLinesMined = dec(1e9);
    state.stats.manualClicks = 400;
    state.stats.prestigeCount = 2;
    state.prestige.techDebt = dec(30);
    state.prestige.permanentUpgrades = { refactoringGrant: 1 };
    state.prestige.totalTechDebtEarned = dec(30);
    state.prestige.baselineLifetimeCash = dec(0);
    return state;
  }

  it('banks the payout into tech debt', () => {
    const before = richState();
    const after = resetForPrestige(before);
    const expected = computeTechDebtGained(before);
    expect(after.prestige.techDebt.toString()).toBe(dec(30).plus(expected).toString());
    expect(after.prestige.totalTechDebtEarned.toString()).toBe(dec(30).plus(expected).toString());
  });

  it('wipes generators, upgrades and run resources', () => {
    const after = resetForPrestige(richState());
    for (const gen of Object.values(after.generators)) {
      expect(gen.owned).toBe(0);
    }
    expect(after.upgrades.purchased).toEqual([]);
    // LoC and coffee are wiped; cash is reset to the starting grant rather than
    // zero, because a run with nothing to spend can never begin.
    expect(Number(after.resources.cash.toString())).toBe(STARTING_CASH);
    expect(after.resources.linesOfCode.toString()).toBe('0');
    expect(after.resources.coffee.toString()).toBe('0');
    expect(after.stats.playSeconds).toBe(0);
    expect(after.stats.manualClicks).toBe(0);
  });

  it('preserves lifetime totals, lifetime cash and permanent upgrades', () => {
    const before = richState();
    const after = resetForPrestige(before);
    expect(Number(after.resources.lifetimeCash.toString())).toBe(Number(before.resources.lifetimeCash.toString()));
    expect(Number(after.stats.totalCashEarned.toString())).toBe(1e8);
    expect(Number(after.stats.totalLinesMined.toString())).toBe(1e9);
    expect(after.prestige.permanentUpgrades.refactoringGrant).toBe(1);
  });

  it('increments the prestige count exactly once', () => {
    const state = richState();
    const after = resetForPrestige(state);
    expect(after.stats.prestigeCount).toBe(state.stats.prestigeCount + 1);
    expect(resetForPrestige(after).stats.prestigeCount).toBe(state.stats.prestigeCount + 2);
  });

  it('does not bump the schema version (that is a save-format concern)', () => {
    expect(resetForPrestige(richState()).version).toBe(CURRENT_SAVE_VERSION);
  });

  it('records the best lifetime cash and never lowers it', () => {
    const first = resetForPrestige(richState());
    expect(Number(first.prestige.bestRunLifetimeCash.toString())).toBe(1e8);

    const worse = richState();
    worse.prestige.bestRunLifetimeCash = dec(5e8);
    worse.resources.lifetimeCash = dec(1e6);
    // A weaker run must not erase a better recorded record.
    expect(Number(resetForPrestige(worse).prestige.bestRunLifetimeCash.toString())).toBe(5e8);

    const better = richState();
    better.prestige.bestRunLifetimeCash = dec(1e6);
    better.resources.lifetimeCash = dec(1e12);
    expect(Number(resetForPrestige(better).prestige.bestRunLifetimeCash.toString())).toBe(1e12);
  });

  it('does not mutate the state it was given', () => {
    const state = richState();
    const snapshot = JSON.stringify(state.upgrades);
    resetForPrestige(state);
    expect(JSON.stringify(state.upgrades)).toBe(snapshot);
  });

  it('keeps generators unlocked that lifetime cash already unlocked', () => {
    const after = resetForPrestige(richState());
    expect(after.generators.k8sCluster.unlocked).toBe(true);
  });
});

describe('resetForPrestige — re-claim regression', () => {
  // A reset preserves lifetimeCash (it drives unlocks and upgrade gates), so if
  // the payout were computed on the raw total a player could reset forever with
  // zero progress and farm Tech Debt indefinitely. Found by driving the prestige
  // panel in a browser: "Reset would award 14" survived the reset that paid it.

  function richState(): GameState {
    const state = createInitialState();
    state.resources.lifetimeCash = dec(1e8);
    state.generators.juniorDev = { owned: 40, unlocked: true };
    state.prestige.baselineLifetimeCash = dec(0);
    return state;
  }

  it('cannot re-claim Tech Debt by resetting twice with no progress', () => {
    // Payout is measured on the state *before* the reset; after it, everything
    // earned so far is banked and nothing is claimable.
    const firstPayout = computeTechDebtGained(richState());
    expect(firstPayout.greaterThan(0)).toBe(true);

    const first = resetForPrestige(richState());
    expect(first.prestige.techDebt.toString()).toBe(firstPayout.toString());

    // Immediately resetting again, having earned nothing new, must award nothing.
    const second = resetForPrestige(first);
    expect(computeTechDebtGained(second).toString()).toBe('0');
    expect(second.prestige.techDebt.toString()).toBe(first.prestige.techDebt.toString());
    expect(second.prestige.totalTechDebtEarned.toString()).toBe(
      first.prestige.totalTechDebtEarned.toString()
    );
  });

  it('can prestige arbitrarily many times without inflating Tech Debt', () => {
    const first = computeTechDebtGained(richState());
    let state = resetForPrestige(richState());
    const debtAfterFirst = state.prestige.techDebt.toString();

    for (let i = 0; i < 50; i += 1) {
      state = resetForPrestige(state);
    }

    expect(state.prestige.techDebt.toString()).toBe(debtAfterFirst);
    expect(state.prestige.totalTechDebtEarned.toString()).toBe(first.toString());
  });

  it('still pays out for genuinely new progress after a reset', () => {
    const first = resetForPrestige(richState());
    const debtAfterFirst = first.prestige.techDebt;

    const second = resetForPrestige({
      ...first,
      resources: { ...first.resources, lifetimeCash: dec(1e10) },
    });

    expect(second.prestige.techDebt.greaterThan(debtAfterFirst)).toBe(true);
    expect(runLifetimeCash(second).toString()).toBe('0');
  });

  it('runLifetimeCash measures progress since the baseline only', () => {
    const state = richState();
    expect(runLifetimeCash(state).toString()).toBe(state.resources.lifetimeCash.toString());

    const partially = { ...state, prestige: { ...state.prestige, baselineLifetimeCash: dec(1e7) } };
    expect(runLifetimeCash(partially).toString()).toBe(dec(1e8).minus(dec(1e7)).toString());
  });

  it('never reports negative unbanked cash if a baseline exceeds lifetime cash', () => {
    const base = richState();
    const state = { ...base, prestige: { ...base.prestige, baselineLifetimeCash: dec(1e12) } };

    expect(runLifetimeCash(state).toString()).toBe('0');
    expect(computeTechDebtGained(state).toString()).toBe('0');
    expect(canPrestige(state)).toBe(false);
  });

  it('canPrestige is false immediately after a reset', () => {
    expect(canPrestige(resetForPrestige(richState()))).toBe(false);
  });

  it('leaves the player able to start a new run', () => {
    // Regression: a reset zeroed cash AND generators. With nothing owned and
    // nothing to spend, no production was possible, so the next run could never
    // begin and the game was permanently dead. The balance simulation's
    // prestige ladder surfaced this -- it stalled after exactly one reset.
    const after = resetForPrestige(richState());
    const cheapest = GENERATOR_DEFS.reduce((min, d) =>
      d.baseCost.lessThan(min.baseCost) ? d : min
    );

    expect(after.resources.cash.greaterThanOrEqualTo(cheapest.baseCost)).toBe(true);
    expect(Object.values(after.generators).every((g) => g.owned === 0)).toBe(true);
  });

  it('gives back the same starting grant a new game receives', () => {
    const after = resetForPrestige(richState());
    expect(after.resources.cash.toString()).toBe(createInitialState().resources.cash.toString());
  });

  it('resumes production after a reset, so the next payout is reachable', () => {
    const state = resetForPrestige(richState());
    state.generators.juniorDev = { owned: 20, unlocked: true };

    // 20 juniors at 0.2/s is 4/s, so ~2000s clears the 1e3 unbanked floor the
    // Tech Debt curve needs before it pays anything at all.
    for (let s = 0; s < 2000; s += 1) engineTick(state, 1, s * 1000);

    expect(state.resources.cash.greaterThan(ZERO)).toBe(true);
    expect(computeTechDebtGained(state).greaterThan(ZERO)).toBe(true);
  });

  it('can chain five prestiges without any of them stalling', () => {
    let state = richState();
    const cheapest = GENERATOR_DEFS.reduce((min, d) =>
      d.baseCost.lessThan(min.baseCost) ? d : min
    );

    for (let run = 0; run < 5; run += 1) {
      state = resetForPrestige(state);

      // Every run must be able to buy back in.
      expect(state.resources.cash.greaterThanOrEqualTo(cheapest.baseCost)).toBe(true);
      state.generators[cheapest.id] = { owned: 20, unlocked: true };

      for (let s = 0; s < 600; s += 1) engineTick(state, 1, s * 1000);

      expect(computeTechDebtGained(state).greaterThan(ZERO)).toBe(true);
    }
  });
});

describe('purchasePermUpgrade', () => {
  function withDebt(debt: number): GameState {
    const state = createInitialState();
    state.prestige.techDebt = dec(debt);
    return state;
  }

  it('refuses when tech debt is insufficient, without mutating', () => {
    const state = withDebt(5);
    const result = purchasePermUpgrade(state, 'refactoringGrant');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Not enough Tech Debt/);
    expect(result.state).toBe(state);
  });

  it('deducts the cost and records the purchase', () => {
    const state = withDebt(100);
    const result = purchasePermUpgrade(state, 'refactoringGrant');
    expect(result.ok).toBe(true);
    expect(result.state.prestige.techDebt.toString()).toBe('75');
    expect(result.state.prestige.permanentUpgrades.refactoringGrant).toBe(1);
  });

  it('does not increment the run/prestige counter', () => {
    const state = withDebt(100);
    expect(purchasePermUpgrade(state, 'refactoringGrant').state.stats.prestigeCount).toBe(
      state.stats.prestigeCount
    );
  });

  it('charges more for each repeat level', () => {
    const base = withDebt(0);
    const first = permUpgradeCost(base, 'refactoringGrant');
    const afterOne: GameState = {
      ...base,
      prestige: { ...base.prestige, permanentUpgrades: { refactoringGrant: 1 } },
    };
    const second = permUpgradeCost(afterOne, 'refactoringGrant');
    expect(second.greaterThan(first)).toBe(true);
  });

  it('applies its multiplier to production', () => {
    const before = computeMultipliers(withDebt(0)).global.toString();
    const after = computeMultipliers(purchasePermUpgrade(withDebt(100), 'refactoringGrant').state)
      .global.toString();
    expect(Number(after)).toBeGreaterThan(Number(before));
    expect(Number(permanentGlobalMult(purchasePermUpgrade(withDebt(100), 'refactoringGrant').state).toString())).toBeCloseTo(1.25, 6);
  });

  it('rejects an unknown id', () => {
    const result = purchasePermUpgrade(withDebt(1e9), 'doesNotExist');
    expect(result.ok).toBe(false);
  });

  it('cannot drive tech debt negative', () => {
    const state = withDebt(25);
    const result = purchasePermUpgrade(state, 'refactoringGrant');
    expect(result.state.prestige.techDebt.toString()).toBe('0');
    expect(result.state.prestige.techDebt.lessThan(ZERO)).toBe(false);
  });
});
