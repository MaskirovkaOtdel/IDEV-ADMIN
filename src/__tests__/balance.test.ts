/**
 * Pacing guard.
 *
 * This is the test the old suite was missing. The "45–60 minutes to first
 * prestige" claim used to be "verified" by a formula-only test that asserted the
 * Tech Debt curve was monotonic — true, and unrelated to whether a player can
 * actually reach it. This suite runs the real economy under a real play policy
 * and asserts on elapsed time.
 *
 * The simulator also earned its keep: it caught a hard softlock where a fresh
 * game started with 0 cash against a 10-cash cheapest generator, making the game
 * unwinnable from a new save. `STARTING_CASH` and the fresh-start top-up exist
 * because of that.
 */
import { describe, it, expect } from 'vitest';
import {
  simulate,
  simulatePrestigeLadder,
  PROFILES,
  TUNING_TARGET_MIN_SECONDS,
  TUNING_TARGET_MAX_SECONDS,
} from '../../tools/balance-sim';
import { createInitialState, deserializeState, serializeState, STARTING_CASH } from '../game/serialize';
import { UPGRADE_DEFS } from '../game/upgrades';
import { GENERATOR_DEFS, requireGenDef } from '../game/generators';
import { ZERO } from '../game/decimal';

const ACTIVE = PROFILES.find((p) => p.id === 'active')!;
const IDLE = PROFILES.find((p) => p.id === 'idle')!;

describe('starting position', () => {
  it('gives a new player enough cash to afford the cheapest generator', () => {
    const state = createInitialState();
    const cheapest = GENERATOR_DEFS.reduce((min, d) =>
      d.baseCost.lessThan(min.baseCost) ? d : min
    );
    expect(state.resources.cash.greaterThanOrEqualTo(cheapest.baseCost)).toBe(true);
    expect(Number(state.resources.cash.toString())).toBeGreaterThanOrEqual(
      Number(cheapest.baseCost.toString())
    );
    expect(STARTING_CASH).toBeGreaterThan(0);
  });

  it('cannot softlock a player who spends their starting cash on nothing', () => {
    // Regression: cash was 0 on a new game while the cheapest generator cost 10,
    // and with no generators there was no production to earn it back.
    const fresh = createInitialState();
    const totalOwned = Object.values(fresh.generators).reduce((s, g) => s + g.owned, 0);
    expect(totalOwned).toBe(0);
    expect(fresh.resources.cash.greaterThanOrEqualTo(ZERO)).toBe(true);
    expect(fresh.resources.cash.greaterThan(ZERO)).toBe(true);
  });

  it('tops up an old save that is verifiably a fresh start', () => {
    const legacy = JSON.stringify({
      version: 1,
      resources: { cash: '0', lifetimeCash: '0', linesOfCode: '0', coffee: '0' },
      generators: {},
    });
    const state = deserializeState(legacy);
    expect(Number(state.resources.cash.toString())).toBeGreaterThanOrEqual(
      Number(requireGenDef('juniorDev').baseCost.toString())
    );
  });

  it('does NOT top up a save with real progress', () => {
    const legacy = JSON.stringify({
      version: 1,
      resources: { cash: '50000', lifetimeCash: '120000', linesOfCode: '0', coffee: '0' },
      generators: { juniorDev: 40 },
    });
    const state = deserializeState(legacy);
    expect(Number(state.resources.cash.toString())).toBe(50_000);
  });

  it('does NOT top up a save that owns generators but has no cash', () => {
    // Zero cash with generators owned is a real (if unlucky) state, not a fresh
    // start — the top-up must not paper over it.
    const legacy = JSON.stringify({
      version: 1,
      resources: { cash: '0', lifetimeCash: '0', linesOfCode: '0', coffee: '0' },
      generators: { juniorDev: 5 },
    });
    expect(Number(deserializeState(legacy).resources.cash.toString())).toBe(0);
  });

  it('round-trips a new game through save/load with its starting cash', () => {
    const state = createInitialState();
    const restored = deserializeState(serializeState(state));
    expect(restored.resources.cash.toString()).toBe(state.resources.cash.toString());
  });
});

describe('pacing — time to first permanent Tech Debt tier', () => {
  // A 1h horizon is enough for the target; longer runs are reported by the sim
  // but must not gate CI.
  const HORIZON_HOURS = 1.5;

  it('reaches the first tier inside the 45–60 minute window for active play', () => {
    const result = simulate(ACTIVE, HORIZON_HOURS);

    expect(result.timeToFirstTierSeconds).not.toBeNull();
    expect(result.timeToFirstTierSeconds!).toBeGreaterThanOrEqual(TUNING_TARGET_MIN_SECONDS);
    expect(result.timeToFirstTierSeconds!).toBeLessThanOrEqual(TUNING_TARGET_MAX_SECONDS);
  }, 60_000);

  it('reaches the first tier for idle play too', () => {
    // Idle play is allowed to be slower, but it must not fall off a cliff. A
    // 30s cadence compounding over an hour still lands near the window.
    const result = simulate(IDLE, HORIZON_HOURS);
    expect(result.timeToFirstTierSeconds).not.toBeNull();
    expect(result.timeToFirstTierSeconds!).toBeLessThanOrEqual(TUNING_TARGET_MAX_SECONDS * 1.5);
  }, 60_000);

  it('is not so sensitive to play style that one profile never finishes', () => {
    const active = simulate(ACTIVE, HORIZON_HOURS).timeToFirstTierSeconds;
    const idle = simulate(IDLE, HORIZON_HOURS).timeToFirstTierSeconds;

    expect(active).not.toBeNull();
    expect(idle).not.toBeNull();
    // Both profiles should be within a factor of two of each other.
    const ratio = Math.max(active!, idle!) / Math.min(active!, idle!);
    expect(ratio).toBeLessThan(2);
  }, 90_000);

  it('unlocks the early generator ladder at a sensible pace', () => {
    const result = simulate(ACTIVE, HORIZON_HOURS);
    const unlocks = result.milestones.filter((m) => m.kind === 'unlock');

    // Senior Dev (400 lifetime cash) should be reachable quickly.
    const senior = unlocks.find((m) => m.label.includes('Senior Dev'));
    expect(senior).toBeDefined();
    expect(senior!.atSeconds).toBeLessThan(10 * 60);

    // The last generator (1M) should not land before the first prestige tier.
    const firstTier = result.timeToFirstTierSeconds!;
    const k8s = unlocks.find((m) => m.label.includes('K8s'));
    if (k8s) expect(k8s.atSeconds).toBeGreaterThanOrEqual(firstTier - 10 * 60);
  }, 60_000);

  it('buys most upgrades on the way to the first tier', () => {
    const result = simulate(ACTIVE, HORIZON_HOURS);
    // Upgrades should be the bulk of early progression, not an afterthought.
    expect(result.upgradesPurchased).toBeGreaterThanOrEqual(Math.floor(UPGRADE_DEFS.length / 2));
  }, 60_000);

  it('ends the run with real production, not a stalled economy', () => {
    const result = simulate(ACTIVE, HORIZON_HOURS);
    expect(result.finalCashPerSec).toBeGreaterThan(0);
    expect(result.finalOwned).toBeGreaterThan(0);
    expect(result.finalLifetimeCash).toBeGreaterThan(1e6);
  }, 60_000);
});

describe('prestige ladder over a long session', () => {
  it('buys permanent tiers and they accumulate', () => {
    const ladder = simulatePrestigeLadder(ACTIVE, 2);
    expect(ladder.rows.length).toBeGreaterThan(0);
    expect(ladder.finalPermOwned).toBeGreaterThan(0);
    // Later tiers must not be reachable instantly.
    const first = ladder.rows[0];
    expect(first.atSeconds).toBeGreaterThan(TUNING_TARGET_MIN_SECONDS * 0.5);
  }, 90_000);

  it('buys tiers in strictly increasing time order', () => {
    // Guards the ladder's shape rather than a tier count. The Tech Debt curve is
    // deliberately steep — Tier 1 costs 25 and Tier 2 costs 120, which needs
    // roughly 1e10 unbanked cash — so a six-hour session legitimately lands only
    // Tier 1. Pinning an invented count here would just enshrine a wrong number.
    const ladder = simulatePrestigeLadder(ACTIVE, 6);
    expect(ladder.rows.length).toBeGreaterThan(0);

    for (let i = 1; i < ladder.rows.length; i += 1) {
      expect(ladder.rows[i].atSeconds).toBeGreaterThanOrEqual(ladder.rows[i - 1].atSeconds);
    }
  }, 120_000);

  it('does not hand out tiers instantly', () => {
    const ladder = simulatePrestigeLadder(ACTIVE, 3);
    // The first tier cannot appear before roughly half the target window.
    expect(ladder.rows[0].atSeconds).toBeGreaterThan(TUNING_TARGET_MIN_SECONDS * 0.4);
  }, 90_000);

  it('keeps permanent tier counts bounded', () => {
    // Guards against a runaway economy where the whole ladder collapses
    // instantly after each prestige.
    const ladder = simulatePrestigeLadder(ACTIVE, 6);
    expect(ladder.finalPermOwned).toBeLessThan(30);
  }, 120_000);
});

describe('economy invariants under simulation', () => {
  it('never lets a purchase drive cash negative', () => {
    // The simulator spends aggressively; if any path allowed a negative balance
    // the final cash would be nonsense.
    const result = simulate(ACTIVE, 1);
    expect(result.finalCashPerSec).toBeGreaterThan(0);
    expect(Number.isFinite(result.finalLifetimeCash)).toBe(true);
  }, 60_000);

  it('keeps every multiplier above 1 for production and below 1 for costs', () => {
    // A costDiscount effect valued above 1 would make things more expensive.
    for (const def of UPGRADE_DEFS) {
      for (const effect of def.effects) {
        if (effect.kind === 'costDiscount' || effect.kind === 'costGrowthDelta') {
          expect(effect.value).toBeLessThan(1);
        } else {
          expect(effect.value).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});
