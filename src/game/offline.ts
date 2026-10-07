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
import { ZERO } from './decimal';

/** Fraction of production credited while away. */
export const OFFLINE_EFFICIENCY = 0.5;
/** Hard cap on credited offline time: 8 hours. */
export const MAX_OFFLINE_SECONDS = 8 * 60 * 60;
/** Below this, showing a modal is just noise. */
export const MIN_OFFLINE_SECONDS_FOR_REPORT = 60;

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
  const effectiveSeconds = cappedSeconds * OFFLINE_EFFICIENCY;

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
      report: { elapsedSeconds, cappedSeconds, effectiveSeconds: 0, gained: {}, trivial: true },
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
    report: { elapsedSeconds, cappedSeconds, effectiveSeconds, gained, trivial },
  };
}

/**
 * Seconds of credited offline time for a given absence — exported for the UI so
 * the modal and the engine can never disagree about the cap.
 */
export function offlineSecondsFor(elapsedMs: number): number {
  return Math.min(Math.max(0, elapsedMs) / 1000, MAX_OFFLINE_SECONDS) * OFFLINE_EFFICIENCY;
}
