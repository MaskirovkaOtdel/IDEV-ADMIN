/**
 * Prestige (reset) system for IDEV : ADMIN.
 *
 * RULES
 *   • A reset wipes generators, upgrades, and all run-scoped resources.
 *   • Tech Debt is awarded from lifetime cash and is permanent.
 *   • Tech Debt buys permanent upgrades (see permUpgrades.ts) that survive every
 *     later reset.
 *
 * TECH DEBT CURVE
 *   The old formula was `log10(lifetimeCash + 1) * 10`, which paid 10 Tech Debt
 *   for 10 lifetime cash — i.e. the first permanent upgrade was effectively free
 *   within the first minute, and the curve was useless past 1e9.
 *
 *   New curve: nothing is awarded below 1e3 lifetime cash, then
 *
 *       techDebt = floor( (log10(lifetimeCash) - 3) ^ 1.6 * 6 )
 *
 *   which gives roughly:
 *       1e5 lifetime cash ->   7 TD
 *       1e6 ->             18 TD
 *       1e7 ->             55 TD     (first permanent upgrade, ~1 hour of play)
 *       1e8 ->             79 TD
 *       1e9 ->            105 TD
 *       1e12 ->           185 TD
 *
 *   `estimatePrestigeMilestones()` documents these numbers and is asserted by the
 *   balance test, so the curve cannot silently drift.
 */
import Decimal from 'break_infinity.js';
import type { GameState, GeneratorId, PermUpgradeId, PrestigeState } from './types';
import { dec, ZERO } from './decimal';
import { GENERATOR_DEFS } from './generators';
import { isGeneratorUnlocked } from './conditions';
import { permUpgradeCost, permUpgradeDef } from './permUpgrades';
import { STARTING_CASH } from './serialize';

/** Save-schema version written by this build. */
export const CURRENT_SAVE_VERSION = 1;

/** Lifetime cash below which a reset awards nothing. */
export const TECH_DEBT_FLOOR_LOG = 3; // 1e3
/**
 * Exponent applied to the decade offset.
 *
 * This is the knob that decides how long the game is. At 1.6 the payout grew
 * by a shrinking factor per decade -- x3.00, then x1.89, x1.62, and by the top
 * of the range x1.11 -- so each extra decade of play was worth barely more than
 * the last. That compressed a huge span of play into a few hundred Tech Debt
 * and left most of the permanent pool permanently out of reach: costs ran to
 * 2,000,000 while even 1e18 lifetime cash paid out 456.
 *
 * At 4 the curve is still gentle where the first prestige happens, and steep
 * where the late game is, so reaching the top of the ladder is a matter of
 * playing rather than a matter of arithmetic that can never close.
 */
export const TECH_DEBT_EXPONENT = 4;
/**
 * Tech Debt per unit of the scaled curve.
 *
 * Chosen so a 1e7 lifetime-cash run still pays 55 -- unchanged from the old
 * curve -- which keeps the 45-60 minute first-prestige window exactly where it
 * was verified. All of the reshaping happens beyond that point.
 */
export const TECH_DEBT_SCALE = 0.215;

/**
 * Every reset pays at least this much.
 *
 * The curve floors to whole Tech Debt, so a steep exponent leaves the first
 * few decades rounding down to zero. That makes a reset pay nothing at all for
 * a short run, which turns prestige into a dead end: the player resets, banks
 * no currency, and has to rebuild from zero to try again. A floor of one keeps
 * prestige always worth doing, and one debt is far too little to matter against
 * the 25-debt first tier.
 */
export const MIN_TECH_DEBT_AWARD = 1;

/** Decimal.log10 of a lifetime-cash value, guarded for values below 1. */
function safeLog10(value: Decimal): number {
  if (value.lessThanOrEqualTo(ZERO)) return 0;
  const log = value.pLog10();
  return Number.isFinite(log) ? log : 0;
}

/**
 * lifetimeCash earned *since the last reset* — the only thing a reset pays for.
 *
 * Because a reset preserves lifetimeCash (it drives unlocks and upgrade gates),
 * paying out on the raw total would let a player reset forever and farm Tech Debt
 * from progress they had already cashed in.
 */
export function runLifetimeCash(state: GameState): Decimal {
  const baseline = state.prestige.baselineLifetimeCash ?? ZERO;
  const earned = state.resources.lifetimeCash.minus(baseline);
  return earned.lessThan(ZERO) ? ZERO : earned;
}

/** Tech Debt awarded by resetting right now. */
export function computeTechDebtGained(state: GameState): Decimal {
  return techDebtForLifetimeCash(runLifetimeCash(state));
}

/** Tech Debt that would be awarded for a hypothetical lifetime cash total. */
export function techDebtForLifetimeCash(lifetimeCash: Decimal): Decimal {
  const decades = safeLog10(lifetimeCash) - TECH_DEBT_FLOOR_LOG;
  if (decades <= 0) return ZERO;
  const scaled = Math.pow(decades, TECH_DEBT_EXPONENT) * TECH_DEBT_SCALE;
  if (!Number.isFinite(scaled) || scaled <= 0) return ZERO;
  return Decimal.fromNumber(Math.max(MIN_TECH_DEBT_AWARD, Math.floor(scaled)));
}

/** Lifetime cash needed to reach a given Tech Debt total (inverse of the curve). */
export function lifetimeCashForTechDebt(techDebt: number): Decimal {
  if (techDebt <= 0) return dec(TECH_DEBT_FLOOR_LOG);
  const decades = TECH_DEBT_FLOOR_LOG + Math.pow(techDebt / TECH_DEBT_SCALE, 1 / TECH_DEBT_EXPONENT);
  return Decimal.pow(10, decades);
}

/** Reference table for the balance test / debug panel. */
export function estimatePrestigeMilestones(): { lifetimeCash: string; techDebt: string }[] {
  return [1e5, 1e6, 1e7, 1e8, 1e9, 1e12].map((cash) => ({
    lifetimeCash: `1e${Math.log10(cash)}`,
    techDebt: techDebtForLifetimeCash(dec(cash)).toString(),
  }));
}

function freshGenerators(state: GameState): GameState['generators'] {
  const map = {} as GameState['generators'];
  for (const def of GENERATOR_DEFS) {
    const id = def.id as GeneratorId;
    map[id] = { owned: 0, unlocked: isGeneratorUnlocked(state, def) };
  }
  return map;
}

/**
 * Apply a permanent upgrade purchase.
 *
 * Returns a new state, or the same state (untouched) when the purchase is not
 * legal — callers get a boolean instead of an exception so a double-click can
 * never corrupt the save.
 */
export function purchasePermUpgrade(state: GameState, id: PermUpgradeId): { state: GameState; ok: boolean; error?: string } {
  const def = permUpgradeDef(id);
  if (!def) return { state, ok: false, error: `Unknown permanent upgrade: ${id}` };

  const cost = permUpgradeCost(state, id);
  if (!cost) return { state, ok: false, error: 'Missing cost' };

  if (state.prestige.techDebt.lessThan(cost)) {
    return {
      state,
      ok: false,
      error: `Not enough Tech Debt: have ${state.prestige.techDebt.toString()}, need ${cost.toString()}`,
    };
  }

  const permanentUpgrades = { ...state.prestige.permanentUpgrades };
  permanentUpgrades[id] = (permanentUpgrades[id] ?? 0) + 1;

  const prestige: PrestigeState = {
    ...state.prestige,
    techDebt: state.prestige.techDebt.minus(cost),
    permanentUpgrades,
  };

  return { state: { ...state, prestige }, ok: true };
}

/** True when the player may reset right now (i.e. would earn Tech Debt). */
export function canPrestige(state: GameState): boolean {
  return computeTechDebtGained(state).greaterThanOrEqualTo(Decimal.fromNumber(1));
}

/**
 * Reset the active run, banking Tech Debt.
 *
 * Preserved: lifetimeCash, lifetime totals, permanent upgrades, Tech Debt.
 * Wiped:     owned generators, purchased upgrades, run resources and run stats.
 */
export function resetForPrestige(state: GameState, now: number = Date.now()): GameState {
  const gained = computeTechDebtGained(state);

  const prestige: PrestigeState = {
    techDebt: state.prestige.techDebt.plus(gained),
    permanentUpgrades: { ...state.prestige.permanentUpgrades },
    totalTechDebtEarned: state.prestige.totalTechDebtEarned.plus(gained),
    bestRunLifetimeCash: Decimal.max(state.prestige.bestRunLifetimeCash, state.resources.lifetimeCash),
    // Everything earned so far is now banked, so it becomes the new baseline.
    baselineLifetimeCash: state.resources.lifetimeCash,
  };

  return {
    version: CURRENT_SAVE_VERSION,
    resources: {
      linesOfCode: ZERO,
      coffee: ZERO,
      // Cash is NOT zeroed. A reset with 0 cash and 0 generators is a dead game:
      // nothing produces, so there is no way to buy the first generator back.
      // This grant is the same one a brand-new game receives, which keeps every
      // post-prestige run playable.
      cash: dec(STARTING_CASH),
      // lifetimeCash is deliberately carried over: it drives unlocks, upgrade
      // gates and future prestige payouts.
      lifetimeCash: state.resources.lifetimeCash,
    },
    generators: freshGenerators(state),
    upgrades: { purchased: [] },
    stats: {
      playSeconds: 0,
      runCashEarned: ZERO,
      totalCashEarned: state.stats.totalCashEarned,
      totalLinesMined: state.stats.totalLinesMined,
      manualClicks: 0,
      prestigeCount: state.stats.prestigeCount + 1,
    },
    prestige,
    lastTickAt: now,
    tickVersion: state.tickVersion + 1,
  };
}
