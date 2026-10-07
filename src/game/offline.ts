/**
 * Offline progression.
 *
 * Rules:
 *   • 50% efficiency while away.
 *   • Hard cap of 8 hours (28800s) of credited time.
 *   • The engine never takes a step longer than 2s, so offline time is walked in
 *     2s chunks through the SAME `engineTick` used by the live loop. That keeps
 *     unlock flags, lifetimeCash and stats consistent whether the player was
 *     watching or asleep — the previous implementation returned hardcoded zeros.
 *
 * Chunking 8h = 14400 steps. That is cheap (~1-2ms) and only happens on the
 * hydration path, so there is no reason to approximate.
 */
import type { GameState, OfflineReport } from './types';
import { MAX_DELTA_SECONDS, engineTick } from './engine';
import { computeMultipliers } from './multipliers';
import { ZERO } from './decimal';

/** Hard cap on credited offline time: 8 hours. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;
/** Below this, showing a modal is just noise. */
export const MIN_OFFLINE_SECONDS_FOR_REPORT = 60;
/** Base efficiency before permanent upgrades. */
export const BASE_OFFLINE_EFFICIENCY = 0.5;
/**
 * Kept as a deprecated alias. Offline efficiency is no longer a constant: it
 * starts at BASE_OFFLINE_EFFICIENCY and is raised by permanent upgrades, so
 * anything that needs the live value must call offlineEfficiencyFor(state).
 */
export const OFFLINE_EFFICIENCY = BASE_OFFLINE_EFFICIENCY;

/** Offline efficiency is clamped here so stacking cannot exceed 100%. */
export const MAX_OFFLINE_EFFICIENCY = 1;

/**
 * Effective offline efficiency for a state, from permanent upgrades.
 * Capped at 100% — an idle game that pays out more than live play would be a
 * bug, not a reward.
 */
export function offlineEfficiencyFor(state: GameState): number {
  const bonus = computeMultipliers(state).offlineEfficiency;
  const raw = BASE_OFFLINE_EFFICIENCY * Number(bonus.toString());
  if (!Number.isFinite(raw)) return BASE_OFFLINE_EFFICIENCY;
  return Math.min(MAX_OFFLINE_EFFICIENCY, raw);
}

/**
 * Apply the time the player was away to a copy of `state`.
 *
 * @param state      current state (never mutated)
 * @param now        epoch ms to anchor to
 * @param elapsedMs  how long the player was away
 */
export function applyOfflineProgress(
  state: GameState,
  elapsedMs: number,
  now: number = Date.now()
): { state: GameState; report: OfflineReport } {
  const elapsedSeconds = Math.max(0, elapsedMs) / 1000;
  const cappedSeconds = Math.min(elapsedSeconds, MAX_OFFLINE_SECONDS);
  const efficiency = offlineEfficiencyFor(state);
  const effectiveSeconds = cappedSeconds * efficiency;

  // Start from a throwaway clone: the engine mutates in place.
  const next: GameState = {
    ...state,
    resources: { ...state.resources },
    stats: { ...state.stats },
    generators: { ...state.generators },
    upgrades: { purchased: [...state.upgrades.purchased] },
    prestige: { ...state.prestige, permanentUpgrades: { ...state.prestige.permanentUpgrades } },
  };

  if (effectiveSeconds <= 0) {
    next.lastTickAt = now;
    return {
      state: next,
      report: {
        elapsedSeconds,
        cappedSeconds,
        effectiveSeconds: 0,
        efficiency,
        gained: {},
        trivial: true,
      },
    };
  }

  const beforeLoC = state.resources.linesOfCode;
  const beforeCoffee = state.resources.coffee;
  const beforeCash = state.resources.cash;

  // Walk the engine in clamped chunks. `lastTickAt` is anchored afterwards so a
  // crash mid-walk cannot double-credit the same absence.
  let remaining = effectiveSeconds;
  while (remaining > 0) {
    const step = Math.min(remaining, MAX_DELTA_SECONDS);
    engineTick(next, step, now);
    remaining -= step;
  }

  next.lastTickAt = now;

  const gained = {
    linesOfCode: next.resources.linesOfCode.minus(beforeLoC),
    coffee: next.resources.coffee.minus(beforeCoffee),
    cash: next.resources.cash.minus(beforeCash),
  };

  const trivial =
    gained.linesOfCode.eq(ZERO) && gained.coffee.eq(ZERO) && gained.cash.eq(ZERO);

  return {
    state: next,
    report: { elapsedSeconds, cappedSeconds, effectiveSeconds, efficiency, gained, trivial },
  };
}

/**
 * Seconds of credited offline time for a given absence — exported for the UI so
 * the modal and the engine can never disagree about the cap.
 */
/**
 * Seconds of credited offline time for a given absence, for a state whose
 * efficiency is supplied. Exported so the UI and the engine cannot disagree
 * about the cap or the multiplier.
 */
export function offlineSecondsFor(elapsedMs: number, efficiency = BASE_OFFLINE_EFFICIENCY): number {
  return Math.min(Math.max(0, elapsedMs) / 1000, MAX_OFFLINE_SECONDS) * efficiency;
}
