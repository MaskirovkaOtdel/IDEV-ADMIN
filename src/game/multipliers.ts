/**
 * Aggregate stacked multipliers from upgrades and permanent (prestige) upgrades.
 *
 * Runs once per tick and produces the MultiplierSnapshot the engine and the UI
 * both read. Multipliers are always derived from raw counts, never stored, so a
 * save can never drift from the simulation.
 *
 * Every effect value is a multiplicative FACTOR, so stacking is unambiguous:
 * `globalMult 1.1` + `globalMult 1.25` => ×1.375.
 */
import Decimal from 'break_infinity.js';
import type {
  GameState,
  GeneratorId,
  MultiplierSnapshot,
  ResourceId,
} from './types';
import { GENERATOR_IDS, RESOURCE_IDS } from './types';
import { UPGRADE_DEFS } from './upgrades';
import { PERM_UPGRADE_DEFS } from './permUpgrades';
import { ONE } from './decimal';

const RESOURCE_SET = new Set<string>(RESOURCE_IDS);
const GENERATOR_SET = new Set<string>(GENERATOR_IDS);

function emptyPerResource(): Record<ResourceId, Decimal> {
  return { linesOfCode: ONE, coffee: ONE, cash: ONE };
}

function emptyPerGenerator(): Record<GeneratorId, Decimal> {
  return GENERATOR_IDS.reduce((acc, id) => {
    acc[id] = ONE;
    return acc;
  }, {} as Record<GeneratorId, Decimal>);
}

/**
 * Build the full multiplier snapshot for a state.
 * Only effects whose `kind` matches are applied — the previous implementation
 * multiplied every upgrade's raw `value` into the global multiplier, which turned
 * a 12% discount into a 0.12x production penalty.
 */
export function computeMultipliers(state: GameState): MultiplierSnapshot {
  // Both upgrade layers use the same effect kinds and are applied through the
  // same switch, so a permanent upgrade can never be given a capability the
  // run-upgrade path does not also support. That is deliberate: the two layers
  // differ in *cost currency* and *persistence*, not in vocabulary.
  const runOwned = new Set(state.upgrades.purchased);
  const snapshot = {
    global: ONE,
    revenueMult: ONE,
    costDiscount: ONE,
    offlineEfficiency: ONE,
    costGrowthDelta: 0,
    perResource: emptyPerResource(),
    perGenerator: emptyPerGenerator(),
  };

  for (const def of UPGRADE_DEFS) {
    if (!runOwned.has(def.id)) continue;
    applyEffects(def.effects, 1, snapshot);
  }

  // Permanent upgrades apply once per level owned, so a level-3 legacyCodebase
  // contributes its effect three times.
  for (const def of PERM_UPGRADE_DEFS) {
    const levels = state.prestige.permanentUpgrades[def.id] ?? 0;
    if (levels <= 0) continue;
    applyEffects(def.effects, levels, snapshot);
  }

  return snapshot;
}

type MutableSnapshot = {
  global: Decimal;
  revenueMult: Decimal;
  costDiscount: Decimal;
  offlineEfficiency: Decimal;
  costGrowthDelta: number;
  perResource: Record<ResourceId, Decimal>;
  perGenerator: Record<GeneratorId, Decimal>;
};

/** Apply one definition's effects `times` times into the accumulating snapshot. */
function applyEffects(effects: readonly { kind: string; target?: string; value: number }[], times: number, acc: MutableSnapshot): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'globalMult':
        acc.global = acc.global.times(Decimal.pow(Decimal.fromNumber(effect.value), times));
        break;
      case 'revenueMult':
        acc.revenueMult = acc.revenueMult.times(Decimal.pow(Decimal.fromNumber(effect.value), times));
        break;
      case 'offlineEfficiency':
        acc.offlineEfficiency = acc.offlineEfficiency.times(
          Decimal.pow(Decimal.fromNumber(effect.value), times)
        );
        break;
      case 'costDiscount':
        acc.costDiscount = acc.costDiscount.times(Decimal.pow(Decimal.fromNumber(effect.value), times));
        break;
      case 'costGrowthDelta':
        acc.costGrowthDelta += effect.value * times;
        break;
      case 'resourceMult': {
        const target = effect.target;
        // Guard: a generatorMult target must never be looked up as a resource.
        if (target && RESOURCE_SET.has(target)) {
          acc.perResource[target as ResourceId] = acc.perResource[target as ResourceId]
            .times(Decimal.pow(Decimal.fromNumber(effect.value), times));
        }
        break;
      }
      case 'generatorMult': {
        const target = effect.target;
        if (target && GENERATOR_SET.has(target)) {
          acc.perGenerator[target as GeneratorId] = acc.perGenerator[target as GeneratorId]
            .times(Decimal.pow(Decimal.fromNumber(effect.value), times));
        }
        break;
      }
    }
  }
}
