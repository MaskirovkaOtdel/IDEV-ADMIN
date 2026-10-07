/**
 * Offline progress tests.
 *
 * The old implementation returned hardcoded zeros from `computeOfflineProgress`
 * and an `estimateOfflineGains` stub that was never called, so "offline progress"
 * credited nothing at all. Now offline time is walked through the real engine.
 */
import { describe, it, expect } from 'vitest';
import { applyOfflineProgress, offlineSecondsFor, OFFLINE_EFFICIENCY, MAX_OFFLINE_SECONDS } from '../game/offline';
import { createInitialState } from '../game/serialize';
import { dec } from '../game/decimal';
import type { GameState } from '../game/types';

function withGenerators(): GameState {
  const state = createInitialState();
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
});
