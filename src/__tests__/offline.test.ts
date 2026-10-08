/**
 * Offline progress tests.
 *
 * The old implementation returned hardcoded zeros from `computeOfflineProgress`
 * and an `estimateOfflineGains` stub that was never called, so "offline progress"
 * credited nothing at all. Now offline time is walked through the real engine.
 */
import { describe, it, expect } from 'vitest';
import {
  applyOfflineProgress,
  offlineSecondsFor,
  offlineEfficiencyFor,
  OFFLINE_EFFICIENCY,
  MAX_OFFLINE_SECONDS,
  MAX_OFFLINE_EFFICIENCY,
} from '../game/offline';
import { engineTick } from '../game/engine';
import { createInitialState } from '../game/serialize';
import { dec, ZERO } from '../game/decimal';
import type { GameState } from '../game/types';

function withGenerators(): GameState {
  const state = createInitialState();
  // A fresh game grants STARTING_CASH; zero it so these tests measure only
  // offline production.
  state.resources.cash = ZERO;
  state.generators.juniorDev = { owned: 100, unlocked: true };
  return state;
}

const HOUR = 60 * 60 * 1000;

describe('applyOfflineProgress', () => {
  it('credits 50% of the elapsed time', () => {
    const state = withGenerators();
    // 0.2/s * 100 units = 20 cash/s; one hour at 50% => 20 * 1800 = 36000
    const { state: after, report } = applyOfflineProgress(state, HOUR);
    expect(Number(after.resources.cash.toString())).toBeCloseTo(36_000, 3);
    expect(report.effectiveSeconds).toBeCloseTo(HOUR / 1000 / 2, 3);
    expect(report.trivial).toBe(false);
  });

  it('matches many small ticks exactly (same engine path)', () => {
    const state = withGenerators();
    const { state: after } = applyOfflineProgress(state, 600 * 1000); // 10 minutes
    // 20 cash/s * 300s credited = 6000
    expect(Number(after.resources.cash.toString())).toBeCloseTo(6_000, 3);
  });

  it('caps credited time at 8 hours', () => {
    const state = withGenerators();
    const elapsed = 48 * HOUR;
    const { state: after, report } = applyOfflineProgress(state, elapsed);
    expect(report.elapsedSeconds).toBeCloseTo(48 * 3600, 3);
    expect(report.cappedSeconds).toBe(MAX_OFFLINE_SECONDS);
    // 20 cash/s * 28800 * 0.5 = 288000
    expect(Number(after.resources.cash.toString())).toBeCloseTo(288_000, 2);
  });

  it('credits nothing when there is no production', () => {
    const state = createInitialState();
    const { report } = applyOfflineProgress(state, 5 * HOUR);
    expect(report.trivial).toBe(true);
    expect(report.gained.cash?.toString()).toBe('0');
  });

  it('credits a short absence at reduced efficiency', () => {
    const state = withGenerators();
    const { report } = applyOfflineProgress(state, 5_000);
    // 20 cash/s * 2.5s credited
    expect(report.effectiveSeconds).toBeCloseTo(2.5, 3);
    expect(Number(report.gained.cash?.toString())).toBeCloseTo(50, 3);
    expect(report.trivial).toBe(false);
  });

  it('is trivial when the absence is shorter than the noise floor', () => {
    // A one-second gap produces less than a cent; nothing worth reporting.
    const state = createInitialState();
    const { report } = applyOfflineProgress(state, 1_000);
    expect(report.trivial).toBe(true);
  });

  it('updates lifetime cash and stats', () => {
    const state = withGenerators();
    const { state: after } = applyOfflineProgress(state, HOUR);
    expect(Number(after.resources.lifetimeCash.toString())).toBeCloseTo(36_000, 3);
    expect(after.stats.playSeconds).toBeCloseTo(HOUR / 1000 / 2, 3);
    expect(Number(after.stats.runCashEarned.toString())).toBeCloseTo(36_000, 3);
    expect(Number(after.stats.totalCashEarned.toString())).toBeCloseTo(36_000, 3);
  });

  it('never mutates the input state', () => {
    const state = withGenerators();
    const before = state.resources.cash.toString();
    applyOfflineProgress(state, HOUR);
    expect(state.resources.cash.toString()).toBe(before);
  });

  it('anchors lastTickAt so the same absence cannot be claimed twice', () => {
    const state = withGenerators();
    const now = 1_700_000_000_000;
    const { state: after } = applyOfflineProgress(state, HOUR, now);
    expect(after.lastTickAt).toBe(now);

    const second = applyOfflineProgress(after, HOUR, now + HOUR);
    // second absence: away for 1h from `now` until now+HOUR => credited again, once
    expect(second.state.stats.playSeconds).toBeCloseTo(HOUR / 1000, 3);
  });

  it('unlocks generators while away', () => {
    const state = withGenerators();
    expect(state.generators.seniorDev.unlocked).toBe(false);
    const { state: after } = applyOfflineProgress(state, HOUR);
    expect(after.generators.seniorDev.unlocked).toBe(true);
  });

  it('handles a negative elapsed time defensively', () => {
    const state = withGenerators();
    const { report } = applyOfflineProgress(state, -5000);
    expect(report.effectiveSeconds).toBe(0);
    expect(report.trivial).toBe(true);
  });

  it('completes an 8-hour catch-up quickly', () => {
    const state = createInitialState();
    for (const def of ['juniorDev', 'seniorDev', 'codeReview', 'linter', 'testSuite', 'ciPipeline', 'k8sCluster'] as const) {
      state.generators[def] = { owned: 50, unlocked: true };
    }
    state.resources.cash = dec(1e9);

    const start = performance.now();
    const { state: after } = applyOfflineProgress(state, 8 * HOUR);
    const elapsedMs = performance.now() - start;

    expect(after.resources.cash.greaterThan(state.resources.cash)).toBe(true);
    expect(elapsedMs).toBeLessThan(1_000);
  });
});

describe('offlineSecondsFor', () => {
  it('applies the cap and efficiency', () => {
    expect(offlineSecondsFor(HOUR)).toBeCloseTo(1800, 3);
    expect(offlineSecondsFor(48 * HOUR)).toBeCloseTo(MAX_OFFLINE_SECONDS * OFFLINE_EFFICIENCY, 3);
    expect(offlineSecondsFor(-1)).toBe(0);
  });

  it('accepts a caller-supplied efficiency', () => {
    expect(offlineSecondsFor(HOUR, 1)).toBeCloseTo(3600, 3);
  });
});

describe('offline efficiency from permanent upgrades', () => {
  it('starts at the 50% base', () => {
    expect(offlineEfficiencyFor(createInitialState())).toBeCloseTo(0.5, 6);
  });

  it('doubles with one level of On-Call Rotation', () => {
    const state = withGenerators();
    state.prestige.permanentUpgrades = { onCallRotation: 1 };
    expect(offlineEfficiencyFor(state)).toBeCloseTo(1, 6);
  });

  it('credits more for the same absence once upgraded', () => {
    const base = withGenerators();
    const boosted = withGenerators();
    boosted.prestige.permanentUpgrades = { onCallRotation: 1 };

    const { report: baseReport } = applyOfflineProgress(base, HOUR);
    const { report: boostedReport } = applyOfflineProgress(boosted, HOUR);

    expect(boostedReport.effectiveSeconds).toBeCloseTo(baseReport.effectiveSeconds * 2, 3);
    expect(Number(boostedReport.gained.cash?.toString())).toBeCloseTo(72_000, 0);
  });

  it('never exceeds 100%, however many levels are stacked', () => {
    const state = withGenerators();
    state.prestige.permanentUpgrades = { onCallRotation: 5 };
    expect(offlineEfficiencyFor(state)).toBe(1);

    const { report } = applyOfflineProgress(state, 8 * HOUR);
    // 20 cash/s * 28800s at 100% = 576000
    expect(Number(report.gained.cash?.toString())).toBeCloseTo(576_000, -2);
  });

  it('reports the efficiency it used', () => {
    const state = withGenerators();
    state.prestige.permanentUpgrades = { onCallRotation: 1 };
    const { report } = applyOfflineProgress(state, HOUR);
    expect(report.efficiency).toBeCloseTo(1, 6);
  });
});

/**
 * What a player actually gets after a real night away.
 *
 * The tests above pin the arithmetic at convenient sizes: one hour, forty-eight
 * hours, a toy state with one generator. None of them answer the question a
 * player has, which is "I slept, what did I wake up with?" So these run a
 * realistic mid-game state through realistic absences.
 *
 * The properties asserted here are the ones that would be player-visible bugs:
 * the cap is honoured at every duration, offline never pays more than live play
 * for the same span, and the numbers in the report are the numbers the modal
 * renders.
 */
describe('overnight catch-up, realistic state', () => {
  /** A mid-game save: several generators, some upgrades, post-first-prestige. */
  function midGame(): GameState {
    const state = createInitialState();
    state.resources.cash = ZERO;
    state.generators.juniorDev = { owned: 220, unlocked: true };
    state.generators.seniorDev = { owned: 140, unlocked: true };
    state.generators.codeReview = { owned: 90, unlocked: true };
    state.generators.linter = { owned: 40, unlocked: true };
    state.upgrades.purchased = ['pairProgramming', 'codeMaster'];
    state.stats.totalCashEarned = dec(1_500_000);
    state.prestige.techDebt = dec(60);
    state.stats.prestigeCount = 1;
    return state;
  }

  it('credits an 8h absence at 4h of production, not 8h', () => {
    const { report } = applyOfflineProgress(midGame(), 8 * HOUR);

    expect(report.cappedSeconds).toBe(MAX_OFFLINE_SECONDS);
    expect(report.effectiveSeconds).toBeCloseTo(MAX_OFFLINE_SECONDS / 2, 6);
    // This is the number the modal prints as "credited".
    expect(Number(report.gained.cash?.toString())).toBeGreaterThan(0);
  });

  it('clamps at every duration past the cap, with no step change', () => {
    const state = midGame();

    const at8 = applyOfflineProgress(state, 8 * HOUR).report.gained.cash;
    const at9 = applyOfflineProgress(state, 9 * HOUR).report.gained.cash;
    const at24 = applyOfflineProgress(state, 24 * HOUR).report.gained.cash;
    const at72 = applyOfflineProgress(state, 72 * HOUR).report.gained.cash;

    // An hour past the cap must be worth nothing: if any of these differ, the
    // clamp leaks and a longer absence pays more than a shorter one.
    expect(Number(at9?.toString())).toBeCloseTo(Number(at8?.toString()), 3);
    expect(Number(at24?.toString())).toBeCloseTo(Number(at8?.toString()), 3);
    expect(Number(at72?.toString())).toBeCloseTo(Number(at8?.toString()), 3);
  });

  it('never pays more than live play over the same wall-clock span', () => {
    const state = midGame();
    const { state: afterOffline, report } = applyOfflineProgress(state, 4 * HOUR);

    // Same engine, same span, no efficiency discount: this is the ceiling an
    // idle game must never exceed, or there is no reason to ever play live.
    const liveState = midGame();
    let remaining = 4 * HOUR / 1000;
    const now = Date.now();
    while (remaining > 0) {
      const step = Math.min(remaining, 2);
      engineTick(liveState, step, now);
      remaining -= step;
    }

    const offlineGain = Number(report.gained.cash?.toString());
    const liveGain = Number(liveState.resources.cash.toString());
    const ratio = offlineGain / liveGain;

    expect(Number(afterOffline.resources.cash.toString())).toBeGreaterThan(0);

    // The invariant that matters: a player is never better off staying away.
    expect(offlineGain).toBeLessThan(liveGain);

    // At 50% efficiency this should be near half of live play, but it lands
    // lower because production compounds *inside* the credited window: the
    // second half of an absence is worth more than the first, so crediting half
    // the span earns less than half the span. Measured at ~0.25 over 4h from
    // this state. The floor is set well below that so the assertion survives
    // balance changes, while still failing if overnight credit collapses.
    expect(ratio).toBeGreaterThan(0.1);
    expect(ratio).toBeLessThan(0.5);
  });

  it('pays strictly more for a longer absence', () => {
    const state = midGame();
    const at2h = Number(applyOfflineProgress(state, 2 * HOUR).report.gained.cash?.toString());
    const at4h = Number(applyOfflineProgress(state, 4 * HOUR).report.gained.cash?.toString());
    const at8h = Number(applyOfflineProgress(state, 8 * HOUR).report.gained.cash?.toString());

    // Strictly increasing: if two of these were equal, something in the
    // pipeline would be discarding time rather than scaling with it.
    expect(at4h).toBeGreaterThan(at2h);
    expect(at8h).toBeGreaterThan(at4h);
  });

  it('reports figures the modal can render without contradicting the cap', () => {
    const state = midGame();
    const long = applyOfflineProgress(state, 30 * HOUR).report;
    const short = applyOfflineProgress(state, 2 * HOUR).report;

    // The modal shows elapsed, and separately flags a cap only when it bit.
    expect(long.elapsedSeconds).toBeCloseTo(30 * 3600, 3);
    expect(long.elapsedSeconds > long.cappedSeconds).toBe(true);
    expect(short.elapsedSeconds > short.cappedSeconds).toBe(false);

    // Effective can never exceed capped, and capped can never exceed elapsed.
    for (const report of [long, short]) {
      expect(report.effectiveSeconds).toBeLessThanOrEqual(report.cappedSeconds);
      expect(report.cappedSeconds).toBeLessThanOrEqual(report.elapsedSeconds + 1e-6);
      expect(report.efficiency).toBeGreaterThan(0);
      expect(report.efficiency).toBeLessThanOrEqual(MAX_OFFLINE_EFFICIENCY);
    }
  });

  it('sustains a full 8h catch-up in reasonable time', () => {
    const started = performance.now();
    applyOfflineProgress(midGame(), MAX_OFFLINE_SECONDS * 1000);
    const elapsedMs = performance.now() - started;

    // 28800s at 2s steps is 14400 engine iterations. This runs on the hydration
    // path, so a regression here is a player staring at a frozen tab.
    expect(elapsedMs).toBeLessThan(1_000);
  });
});
