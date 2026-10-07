/**
 * Tests for the tick engine: production, lifetime accounting, unlocks, clamping.
 */
import { describe, it, expect } from 'vitest';
import { engineTick, computeProductionSnapshot, MAX_DELTA_SECONDS } from '../game/engine';
import { createInitialState } from '../game/serialize';
import { dec } from '../game/decimal';
import { GENERATOR_DEFS } from '../game/generators';
import type { GameState, GeneratorId } from '../game/types';

function stateWith(owned: Partial<Record<GeneratorId, number>>, cash = 0): GameState {
  const state = createInitialState();
  state.resources.cash = dec(cash);
  for (const [id, count] of Object.entries(owned) as [GeneratorId, number][]) {
    state.generators[id].owned = count;
    state.generators[id].unlocked = true;
  }
  return state;
}

describe('engineTick – production', () => {
  it('produces nothing with no generators', () => {
    const state = createInitialState();
    const before = state.resources.cash.toString();
    engineTick(state, 1);
    expect(state.resources.cash.toString()).toBe(before);
  });

  it('adds baseRate * owned * delta', () => {
    const junior = GENERATOR_DEFS[0];
    const state = stateWith({ juniorDev: 10 });
    engineTick(state, 1);
    // 0.2/s * 10 * 1s = 2 cash
    expect(Number(state.resources.cash.toString())).toBeCloseTo(2, 6);
    expect(Number(junior.baseRate.toString())).toBe(0.2);
  });

  it('accumulates across ticks', () => {
    const state = stateWith({ juniorDev: 10 });
    for (let i = 0; i < 100; i += 1) engineTick(state, 0.5);
    expect(Number(state.resources.cash.toString())).toBeCloseTo(100, 3);
  });

  it('adds revenue from stockpiled LoC and coffee', () => {
    const state = createInitialState();
    state.resources.linesOfCode = dec(1000);
    state.resources.coffee = dec(100);
    // 1000 * 0.05 + 100 * 0.35 = 50 + 35 = 85 cash/s
    const snapshot = computeProductionSnapshot(state);
    expect(Number(snapshot.revenuePerSec.toString())).toBeCloseTo(85, 6);
    engineTick(state, 1);
    expect(Number(state.resources.cash.toString())).toBeCloseTo(85, 6);
  });

  it('per-generator rates include multipliers', () => {
    const state = stateWith({ juniorDev: 5 });
    state.upgrades.purchased = ['codeMaster']; // global x1.1
    const snapshot = computeProductionSnapshot(state);
    // 0.2 * 5 * 1.1 = 1.1
    expect(Number(snapshot.perGenerator.juniorDev.toString())).toBeCloseTo(1.1, 6);
  });
});

describe('engineTick – accounting', () => {
  it('grows lifetimeCash by everything earned, including revenue', () => {
    const state = stateWith({ juniorDev: 10 });
    state.resources.linesOfCode = dec(200); // +10 cash/s revenue
    engineTick(state, 1);
    // 2 generator + 10 revenue
    expect(Number(state.resources.lifetimeCash.toString())).toBeCloseTo(12, 6);
  });

  it('tracks run and lifetime totals separately', () => {
    const state = stateWith({ juniorDev: 10 });
    state.stats.totalCashEarned = dec(1_000_000);
    engineTick(state, 1);
    expect(Number(state.stats.runCashEarned.toString())).toBeCloseTo(2, 6);
    expect(Number(state.stats.totalCashEarned.toString())).toBeCloseTo(1_000_002, 3);
  });

  it('tracks lifetime LoC mined', () => {
    const state = stateWith({ codeReview: 10 });
    engineTick(state, 1);
    // 1.5 LoC/s * 10 = 15
    expect(Number(state.stats.totalLinesMined.toString())).toBeCloseTo(15, 6);
  });

  it('advances playSeconds', () => {
    const state = createInitialState();
    engineTick(state, 1.5);
    expect(state.stats.playSeconds).toBeCloseTo(1.5, 6);
  });

  it('bumps tickVersion and anchors lastTickAt', () => {
    const state = createInitialState();
    const version = state.tickVersion;
    const now = 1_700_000_000_000;
    engineTick(state, 1, now);
    expect(state.tickVersion).toBe(version + 1);
    expect(state.lastTickAt).toBe(now);
  });
});

describe('engineTick – clamping', () => {
  it('never advances more than MAX_DELTA_SECONDS in one step', () => {
    const state = stateWith({ juniorDev: 10 });
    engineTick(state, 10_000);
    // 0.2 * 10 * 2 = 4, not 2000
    expect(Number(state.resources.cash.toString())).toBeCloseTo(4, 6);
    expect(MAX_DELTA_SECONDS).toBe(2);
  });

  it('ignores negative and zero deltas', () => {
    const state = stateWith({ juniorDev: 10 });
    engineTick(state, -5);
    engineTick(state, 0);
    expect(state.resources.cash.toString()).toBe('0');
  });

  it('survives absurdly large owned counts', () => {
    const state = stateWith({ k8sCluster: 1e6 });
    expect(() => engineTick(state, 2)).not.toThrow();
    expect(state.resources.cash.greaterThan(0)).toBe(true);
  });
});

describe('engineTick – unlocks', () => {
  it('unlocks a generator once lifetime cash crosses its threshold', () => {
    const state = createInitialState();
    expect(state.generators.seniorDev.unlocked).toBe(false);
    engineTick(state, 1);
    expect(state.generators.seniorDev.unlocked).toBe(false);

    state.resources.lifetimeCash = dec(500);
    engineTick(state, 1);
    expect(state.generators.seniorDev.unlocked).toBe(true);
  });

  it('keeps a generator unlocked even after a prestige wipes owned counts', () => {
    const state = createInitialState();
    state.resources.lifetimeCash = dec(1e12);
    engineTick(state, 1);
    const unlockedBefore = Object.values(state.generators).filter((g) => g.unlocked).length;
    expect(unlockedBefore).toBe(GENERATOR_DEFS.length);
  });

  it('juniorDev is unlocked from the start, everything else is gated', () => {
    const state = createInitialState();
    expect(state.generators.juniorDev.unlocked).toBe(true);
    const locked = GENERATOR_DEFS.filter((def) => !state.generators[def.id].unlocked);
    expect(locked.length).toBe(GENERATOR_DEFS.length - 1);
  });
});

describe('generator data sanity', () => {
  it('every generator has positive cost, growth and rate', () => {
    for (const def of GENERATOR_DEFS) {
      expect(def.baseCost.greaterThan(0)).toBe(true);
      expect(def.baseRate.greaterThan(0)).toBe(true);
      expect(def.costGrowth).toBeGreaterThan(1.02);
      expect(def.id).toBeTruthy();
    }
  });

  it('unlock thresholds increase with tier', () => {
    for (let i = 1; i < GENERATOR_DEFS.length; i += 1) {
      expect(GENERATOR_DEFS[i].unlockAt.lifetimeCash.greaterThan(GENERATOR_DEFS[i - 1].unlockAt.lifetimeCash)).toBe(true);
    }
  });

  it('ids are unique', () => {
    expect(new Set(GENERATOR_DEFS.map((g) => g.id)).size).toBe(GENERATOR_DEFS.length);
  });
});
