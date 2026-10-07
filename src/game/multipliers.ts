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
import { permanentGlobalMult, permanentCostMult } from './permUpgrades';
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
  const purchased = state.upgrades.purchased;
  const purchasedSet = new Set(purchased);

  let global = ONE;
  let revenueMult = ONE;
  let costDiscount = ONE;
  let costGrowthDelta = 0;
  const perResource = emptyPerResource();
  const perGenerator = emptyPerGenerator();

  for (const def of UPGRADE_DEFS) {
    if (!purchasedSet.has(def.id)) continue;
    for (const effect of def.effects) {
      switch (effect.kind) {
        case 'globalMult':
          global = global.times(Decimal.fromNumber(effect.value));
          break;
        case 'revenueMult':
          revenueMult = revenueMult.times(Decimal.fromNumber(effect.value));
          break;
        case 'costDiscount':
          costDiscount = costDiscount.times(Decimal.fromNumber(effect.value));
          break;
        case 'costGrowthDelta':
          costGrowthDelta += effect.value;
          break;
        case 'resourceMult': {
          const target = effect.target;
          // Guard: a generatorMult target must never be looked up as a resource.
          if (target && RESOURCE_SET.has(target)) {
            perResource[target as ResourceId] = perResource[target as ResourceId]
              .times(Decimal.fromNumber(effect.value));
          }
          break;
        }
        case 'generatorMult': {
          const target = effect.target;
          if (target && GENERATOR_SET.has(target)) {
            perGenerator[target as GeneratorId] = perGenerator[target as GeneratorId]
              .times(Decimal.fromNumber(effect.value));
          }
          break;
        }
      }
    }
  }

  global = global.times(permanentGlobalMult(state));
  costDiscount = costDiscount.times(permanentCostMult(state));

  return { global, perResource, perGenerator, costDiscount, costGrowthDelta, revenueMult };
}
