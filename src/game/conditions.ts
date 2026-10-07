/**
 * Unlock and requirement predicates.
 *
 * Single source of truth shared by the engine (which flips unlock flags during a
 * tick), the store (which refuses illegal purchases) and the UI (which greys out
 * locked cards). Keeping them here is what stops the old class of bug where the
 * card said "affordable" and the action silently did nothing.
 */
import type { GameState, GeneratorDef, UpgradeDef } from './types';
import { GENERATOR_DEFS } from './generators';
import { GENERATOR_NAMES } from './labels';

/** A generator is visible/buyable once lifetime cash crosses its threshold. */
export function isGeneratorUnlocked(state: GameState, def: GeneratorDef): boolean {
  const owned = state.generators[def.id]?.owned ?? 0;
  if (owned > 0) return true; // never re-lock something already owned
  return state.resources.lifetimeCash.greaterThanOrEqualTo(def.unlockAt.lifetimeCash);
}

/** Generators whose lifetimeCash threshold has been crossed but not yet flagged. */
export function newlyUnlockedGenerators(state: GameState): GeneratorDef[] {
  return GENERATOR_DEFS.filter((def) => !state.generators[def.id].unlocked && isGeneratorUnlocked(state, def));
}

export interface RequirementResult {
  met: boolean;
  reason?: string;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (value < 1000) return value.toLocaleString('en-US');
  return value.toExponential(2);
}

/** Check every gate on an upgrade. Returns the first unmet gate, if any. */
export function meetsUpgradeRequirements(state: GameState, def: UpgradeDef): RequirementResult {
  const req = def.requires;
  if (!req) return { met: true };

  if (req.generatorId) {
    const owned = state.generators[req.generatorId]?.owned ?? 0;
    if (owned < (req.owned ?? 0)) {
      const label = GENERATOR_NAMES[req.generatorId] ?? req.generatorId;
      return {
        met: false,
        reason: `Requires ${req.owned} × ${label} (you have ${owned})`,
      };
    }
  }

  if (req.lifetimeCash && state.resources.lifetimeCash.lessThan(req.lifetimeCash)) {
    return { met: false, reason: `Requires ${formatNumber(Number(req.lifetimeCash.toString()))} lifetime cash` };
  }

  if (req.totalLinesMined && state.stats.totalLinesMined.lessThan(req.totalLinesMined)) {
    return { met: false, reason: `Requires ${formatNumber(Number(req.totalLinesMined.toString()))} lifetime LoC` };
  }

  if (req.upgrades?.length) {
    const missing = req.upgrades.filter((id) => !state.upgrades.purchased.includes(id));
    if (missing.length > 0) return { met: false, reason: `Requires ${missing.join(', ')}` };
  }

  return { met: true };
}

/** True when the player can pay for an upgrade's cost. */
export function canAffordUpgrade(state: GameState, def: UpgradeDef): boolean {
  return state.resources[def.cost.resource].greaterThanOrEqualTo(def.cost.amount);
}
