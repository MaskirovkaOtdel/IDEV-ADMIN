/**
 * Permanent (prestige-layer) upgrades bought with Tech Debt.
 *
 * These survive every reset and are the reason to prestige at all. Each one can
 * be bought repeatedly; every repeat costs `costMultiplier` times as much Tech
 * Debt as the previous level, so the layer stays relevant for a long time.
 *
 * Kept in its own module so `multipliers.ts` can read it without importing
 * `prestige.ts` (which would create an import cycle).
 */
import type { GameState, PermUpgradeDef, PermUpgradeId } from './types';
import Decimal from 'break_infinity.js';
import { dec, ONE } from './decimal';

export const PERM_UPGRADE_DEFS: PermUpgradeDef[] = [
  {
    id: 'refactoringGrant',
    name: 'Refactoring Grant',
    description: 'Permanent ×1.25 to all production.',
    baseCost: dec(25),
    costMultiplier: 3,
    globalMult: 1.25,
  },
  {
    id: 'openSourceSponsor',
    name: 'Open Source Sponsorship',
    description: 'Permanent ×1.25 to all production, and generator costs ×0.95.',
    baseCost: dec(120),
    costMultiplier: 3,
    globalMult: 1.25,
    costMult: 0.95,
  },
  {
    id: 'vcBacking',
    name: 'VC Backing',
    description: 'Permanent ×1.30 to all production, and generator costs ×0.90.',
    baseCost: dec(600),
    costMultiplier: 3,
    globalMult: 1.3,
    costMult: 0.9,
  },
  {
    id: 'aiSwarmLicense',
    name: 'AI Swarm License',
    description: 'Permanent ×1.40 to all production, and generator costs ×0.85.',
    baseCost: dec(3_000),
    costMultiplier: 3,
    globalMult: 1.4,
    costMult: 0.85,
  },
  {
    id: 'timeLoop',
    name: 'Time Loop',
    description: 'Permanent ×1.75 to all production, and generator costs ×0.75.',
    baseCost: dec(25_000),
    costMultiplier: 3,
    globalMult: 1.75,
    costMult: 0.75,
  },
];

const BY_ID = new Map<PermUpgradeId, PermUpgradeDef>(PERM_UPGRADE_DEFS.map((u) => [u.id, u]));

export function permUpgradeDef(id: PermUpgradeId): PermUpgradeDef | undefined {
  return BY_ID.get(id);
}

/** Tech Debt cost of the *next* level of a permanent upgrade, or null if unknown. */
export function permUpgradeCost(state: GameState, id: PermUpgradeId): Decimal {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown permanent upgrade: ${id}`);
  const owned = state.prestige.permanentUpgrades[id] ?? 0;
  return def.baseCost.times(Decimal.pow(dec(def.costMultiplier), owned));
}

/** Permanent global production factor from every permanent upgrade owned. */
export function permanentGlobalMult(state: GameState): Decimal {
  let result = ONE;
  for (const def of PERM_UPGRADE_DEFS) {
    const owned = state.prestige.permanentUpgrades[def.id] ?? 0;
    if (owned > 0) result = result.times(Decimal.pow(dec(def.globalMult), owned));
  }
  return result;
}

/** Permanent generator-cost factor from every permanent upgrade owned. */
export function permanentCostMult(state: GameState): Decimal {
  let result = ONE;
  for (const def of PERM_UPGRADE_DEFS) {
    const owned = state.prestige.permanentUpgrades[def.id] ?? 0;
    if (owned > 0 && def.costMult) {
      result = result.times(Decimal.pow(dec(def.costMult), owned));
    }
  }
  return result;
}
