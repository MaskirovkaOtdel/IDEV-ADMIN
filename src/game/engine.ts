/**
 * Core tick engine — pure functions, no React and no store imports.
 *
 * `engineTick` mutates the GameState it is given (the store always hands it a
 * throwaway clone) and returns the ProductionSnapshot the UI renders.
 *
 * Delta clamping: a single step never advances more than MAX_DELTA_SECONDS, so a
 * backgrounded tab cannot produce one enormous jump. Long absences are handled by
 * `offline.ts`, which walks the same engine in capped chunks.
 */
import Decimal from 'break_infinity.js';
import type { GameState, GeneratorId, ProductionSnapshot, ResourceId } from './types';
import { GENERATOR_IDS } from './types';
import { GENERATOR_DEFS, REVENUE_PER_COFFEE, REVENUE_PER_LOC } from './generators';
import { computeMultipliers } from './multipliers';
import { computeProduction } from './formulas';
import { newlyUnlockedGenerators } from './conditions';
import { dec, ONE, ZERO } from './decimal';

/** Max seconds a single engine step may advance. */
export const MAX_DELTA_SECONDS = 2;

function emptyProduction(): Record<ResourceId, Decimal> {
  return { linesOfCode: ZERO, coffee: ZERO, cash: ZERO };
}

/**
 * Compute (without applying) what each resource would gain per second.
 * The UI uses this for the "/sec" readouts, so it must stay allocation-light.
 */
export function computeProductionSnapshot(state: GameState): ProductionSnapshot {
  const mult = computeMultipliers(state);
  const perResource = emptyProduction();
  const perGenerator = GENERATOR_IDS.reduce((acc, id) => {
    acc[id] = ZERO;
    return acc;
  }, {} as Record<GeneratorId, Decimal>);

  for (const def of GENERATOR_DEFS) {
    const owned = state.generators[def.id]?.owned ?? 0;
    if (owned <= 0) continue;
    const rate = computeProduction(
      def.baseRate,
      owned,
      mult.perGenerator[def.id],
      mult.perResource[def.produces],
      mult.global
    );
    perGenerator[def.id] = rate;
    perResource[def.produces] = perResource[def.produces].plus(rate);
  }

  // Revenue: stockpiled LoC and Coffee bill out as Cash every second.
  const revenue = state.resources.linesOfCode
    .times(dec(REVENUE_PER_LOC))
    .plus(state.resources.coffee.times(dec(REVENUE_PER_COFFEE)))
    .times(mult.revenueMult)
    .times(mult.global);
  perResource.cash = perResource.cash.plus(revenue);

  return {
    perResource,
    perGenerator,
    revenuePerSec: revenue,
    cashPerSec: perResource.cash,
  };
}

/**
 * Advance the simulation by `deltaSeconds` (clamped), mutating `state`.
 *
 * Also refreshes generator unlock flags and anchors `lastTickAt` so offline
 * progress always measures from the last known-good point.
 */
export function engineTick(state: GameState, deltaSeconds: number, now: number = Date.now()): ProductionSnapshot {
  const delta = Math.min(Math.max(0, deltaSeconds), MAX_DELTA_SECONDS);
  const snapshot = computeProductionSnapshot(state);
  if (delta <= 0) {
    state.lastTickAt = now;
    return snapshot;
  }

  const seconds = dec(delta);
  const gainedLoc = snapshot.perResource.linesOfCode.times(seconds);
  const gainedCoffee = snapshot.perResource.coffee.times(seconds);
  const gainedCash = snapshot.perResource.cash.times(seconds);

  state.resources.linesOfCode = state.resources.linesOfCode.plus(gainedLoc);
  state.resources.coffee = state.resources.coffee.plus(gainedCoffee);
  state.resources.cash = state.resources.cash.plus(gainedCash);

  // lifetimeCash is the backbone of unlocks, upgrade gates and prestige — it must
  // only ever grow, and it must include revenue, not just generator output.
  state.resources.lifetimeCash = state.resources.lifetimeCash.plus(gainedCash);

  state.stats.playSeconds += delta;
  state.stats.runCashEarned = state.stats.runCashEarned.plus(gainedCash);
  state.stats.totalCashEarned = state.stats.totalCashEarned.plus(gainedCash);
  state.stats.totalLinesMined = state.stats.totalLinesMined.plus(gainedLoc);

  for (const def of newlyUnlockedGenerators(state)) {
    state.generators[def.id].unlocked = true;
  }

  state.lastTickAt = now;
  state.tickVersion += 1;
  return snapshot;
}

/** Production snapshot with every multiplier forced to 1 — used by tests. */
export function rawProductionOf(state: GameState, multiplier: Decimal = ONE): ProductionSnapshot {
  const perResource = emptyProduction();
  const perGenerator = GENERATOR_IDS.reduce((acc, id) => {
    acc[id] = ZERO;
    return acc;
  }, {} as Record<GeneratorId, Decimal>);

  for (const def of GENERATOR_DEFS) {
    const owned = state.generators[def.id]?.owned ?? 0;
    if (owned <= 0) continue;
    const rate = computeProduction(def.baseRate, owned, ONE, ONE, multiplier);
    perGenerator[def.id] = rate;
    perResource[def.produces] = perResource[def.produces].plus(rate);
  }

  return { perResource, perGenerator, revenuePerSec: ZERO, cashPerSec: perResource.cash };
}
