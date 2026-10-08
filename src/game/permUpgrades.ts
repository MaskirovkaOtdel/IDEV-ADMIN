/**
 * Permanent (prestige-layer) upgrades bought with Tech Debt.
 *
 * These survive every reset and are the reason to prestige at all. Each is
 * repeatable; every repeat costs `costMultiplier` times as much Tech Debt as the
 * previous level, so the layer stays relevant for a long time.
 *
 * WHY THIS POOL IS LARGE
 * ----------------------
 * The pool was five entries, all of which did one thing: multiply a global
 * production number. That is not a progression, it is one number getting
 * bigger — and it is why content ran out around the one-hour mark, leaving
 * players with nothing to spend Tech Debt on and nothing new to think about.
 *
 * The fix is breadth of *kind*, not just magnitude. The pool now spans every
 * effect the simulation supports:
 *   • global production       — the classic, strongest, most expensive
 *   • per-generator output    — makes a prestige feel like a different build
 *   • revenue conversion      — rewards stockpiling the side resources
 *   • cost discount           — cheaper compounding
 *   • cost growth reduction   — long-run structural power
 *   • offline efficiency      — the one stat an idle game player actually feels
 *
 * Tiers 1-5 keep their original ids, global multipliers and costs, so existing
 * saves keep their values. Everything after tier 5 is new.
 *
 * Kept in its own module so `multipliers.ts` can read it without importing
 * `prestige.ts`, which would create an import cycle.
 */
import type { GameState, PermUpgradeDef, PermUpgradeId } from './types';
import Decimal from 'break_infinity.js';
import { dec, ONE } from './decimal';

export const PERM_UPGRADE_DEFS: PermUpgradeDef[] = [
  // --- Tier 1-5: the original five. Ids, costs and effects are unchanged so
  // existing saves keep their values. ------------------------------------------------
  {
    id: 'refactoringGrant',
    name: 'Refactoring Grant',
    description: 'Permanent ×1.25 to all production.',
    baseCost: dec(25),
    costMultiplier: 3,
    group: 'production',
    effects: [{ kind: 'globalMult', value: 1.25 }],
  },
  {
    id: 'openSourceSponsor',
    name: 'Open Source Sponsorship',
    description: 'Permanent ×1.25 to all production, and generator costs ×0.95.',
    baseCost: dec(120),
    costMultiplier: 3,
    group: 'production',
    effects: [
      { kind: 'globalMult', value: 1.25 },
      { kind: 'costDiscount', value: 0.95 },
    ],
  },
  {
    id: 'vcBacking',
    name: 'VC Backing',
    description: 'Permanent ×1.30 to all production, and generator costs ×0.90.',
    baseCost: dec(600),
    costMultiplier: 3,
    group: 'production',
    effects: [
      { kind: 'globalMult', value: 1.3 },
      { kind: 'costDiscount', value: 0.9 },
    ],
  },
  {
    id: 'aiSwarmLicense',
    name: 'AI Swarm License',
    description: 'Permanent ×1.40 to all production, and generator costs ×0.85.',
    baseCost: dec(3_000),
    costMultiplier: 3,
    group: 'production',
    effects: [
      { kind: 'globalMult', value: 1.4 },
      { kind: 'costDiscount', value: 0.85 },
    ],
  },
  {
    id: 'timeLoop',
    name: 'Time Loop',
    description: 'Permanent ×1.75 to all production, and generator costs ×0.75.',
    baseCost: dec(25_000),
    costMultiplier: 3,
    group: 'production',
    effects: [
      { kind: 'globalMult', value: 1.75 },
      { kind: 'costDiscount', value: 0.75 },
    ],
  },

  // --- Tier 6-10: structural. Cheaper than the global multipliers above, but
  // they compound rather than just adding to a number. ----------------------
  {
    id: 'legacyCodebase',
    name: 'Legacy Codebase',
    description: 'Permanent −0.01 to every generator cost growth (1.15 → 1.14).',
    baseCost: dec(60),
    costMultiplier: 2.5,
    group: 'economy',
    effects: [{ kind: 'costGrowthDelta', value: -0.01 }],
  },
  {
    id: 'freelanceRetainer',
    name: 'Freelance Retainer',
    description: 'Permanent ×2 revenue from stockpiled LoC and Coffee.',
    baseCost: dec(150),
    costMultiplier: 3,
    group: 'economy',
    effects: [{ kind: 'revenueMult', value: 2 }],
  },
  {
    id: 'onCallRotation',
    name: 'On-Call Rotation',
    description: 'Permanent ×2 offline efficiency (50% → 100%).',
    baseCost: dec(400),
    costMultiplier: 2.5,
    group: 'convenience',
    effects: [{ kind: 'offlineEfficiency', value: 2 }],
  },
  {
    id: 'seniorArchitect',
    name: 'Senior Architect',
    description: 'Permanent ×2 Junior Dev and Senior Dev production.',
    baseCost: dec(800),
    costMultiplier: 3,
    group: 'production',
    effects: [
      { kind: 'generatorMult', target: 'juniorDev', value: 2 },
      { kind: 'generatorMult', target: 'seniorDev', value: 2 },
    ],
  },
  {
    id: 'platformTeam',
    name: 'Platform Team',
    description: 'Permanent ×2 Code Review and Linter production.',
    baseCost: dec(1_500),
    costMultiplier: 3,
    group: 'production',
    effects: [
      { kind: 'generatorMult', target: 'codeReview', value: 2 },
      { kind: 'generatorMult', target: 'linter', value: 2 },
    ],
  },

  // --- Tier 11-15: the deep end. Expensive, and the effects are specific
  // enough that they change which build is best. ----------------------------
  {
    id: 'sreGuild',
    name: 'SRE Guild',
    description: 'Permanent ×2 CI/CD Pipeline and K8s Cluster production.',
    baseCost: dec(4_000),
    costMultiplier: 3,
    group: 'production',
    effects: [
      { kind: 'generatorMult', target: 'ciPipeline', value: 2 },
      { kind: 'generatorMult', target: 'k8sCluster', value: 2 },
    ],
  },
  {
    id: 'monorepoMigration',
    name: 'Monorepo Migration',
    description: 'Permanent −0.02 to every generator cost growth, and costs ×0.9.',
    baseCost: dec(9_000),
    costMultiplier: 2.5,
    group: 'economy',
    effects: [
      { kind: 'costGrowthDelta', value: -0.02 },
      { kind: 'costDiscount', value: 0.9 },
    ],
  },
  {
    id: 'consultingFirm',
    name: 'Consulting Firm',
    description: 'Permanent ×3 revenue, and ×1.5 to all production.',
    baseCost: dec(40_000),
    costMultiplier: 3,
    group: 'economy',
    effects: [
      { kind: 'revenueMult', value: 3 },
      { kind: 'globalMult', value: 1.5 },
    ],
  },
  {
    id: 'distributedTeam',
    name: 'Distributed Team',
    description: 'Permanent ×2 offline efficiency, and ×1.5 to all production.',
    baseCost: dec(100_000),
    costMultiplier: 3,
    group: 'convenience',
    effects: [
      { kind: 'offlineEfficiency', value: 2 },
      { kind: 'globalMult', value: 1.5 },
    ],
  },
  {
    id: 'sovereignCloud',
    name: 'Sovereign Cloud',
    description: 'Permanent ×1.75 to all production, and costs ×0.6.',
    baseCost: dec(500_000),
    costMultiplier: 3,
    group: 'production',
    effects: [
      { kind: 'globalMult', value: 1.75 },
      { kind: 'costDiscount', value: 0.6 },
    ],
  },

  // --- Tier 16-22: the late layer. ------------------------------------------------------
  //
  // These are reachable now, which the tier 11-15 entries were not: with the
  // payout curve in prestige.ts, anything above a few thousand Tech Debt sat
  // behind arithmetic that could never close. Costs here are chosen to sit
  // above what a first day of play banks, so they are goals rather than
  // filler, and to spread across the effect kinds that were thin up here.
  {
    id: 'staffAugmentation',
    name: 'Staff Augmentation',
    description: 'Permanent ×3 Junior Dev, Senior Dev and Code Review production.',
    baseCost: dec(8_000),
    costMultiplier: 3.5,
    group: 'production',
    effects: [
      { kind: 'generatorMult', target: 'juniorDev', value: 3 },
      { kind: 'generatorMult', target: 'seniorDev', value: 3 },
      { kind: 'generatorMult', target: 'codeReview', value: 3 },
    ],
  },
  {
    id: 'testAutomation',
    name: 'Test Automation',
    description: 'Permanent ×3 Linter, Test Suite and CI/CD Pipeline production.',
    baseCost: dec(20_000),
    costMultiplier: 3.5,
    group: 'production',
    effects: [
      { kind: 'generatorMult', target: 'linter', value: 3 },
      { kind: 'generatorMult', target: 'testSuite', value: 3 },
      { kind: 'generatorMult', target: 'ciPipeline', value: 3 },
    ],
  },
  {
    id: 'infrastructureAsCode',
    name: 'Infrastructure as Code',
    description: 'Permanent ×3 K8s Cluster production, and −0.01 to every generator cost growth.',
    baseCost: dec(60_000),
    costMultiplier: 3.5,
    group: 'economy',
    effects: [
      { kind: 'generatorMult', target: 'k8sCluster', value: 3 },
      { kind: 'costGrowthDelta', value: -0.01 },
    ],
  },
  {
    id: 'revenueStream',
    name: 'Revenue Stream',
    description: 'Permanent ×4 revenue from stockpiled LoC and Coffee.',
    baseCost: dec(150_000),
    costMultiplier: 3.5,
    group: 'economy',
    effects: [{ kind: 'revenueMult', value: 4 }],
  },
  {
    id: 'chaosEngineering',
    name: 'Chaos Engineering',
    description: 'Permanent ×1.6 offline efficiency, and generator costs ×0.85.',
    baseCost: dec(300_000),
    costMultiplier: 3.5,
    group: 'convenience',
    effects: [
      { kind: 'offlineEfficiency', value: 1.6 },
      { kind: 'costDiscount', value: 0.85 },
    ],
  },
  {
    id: 'zeroDowntime',
    name: 'Zero Downtime',
    description: 'Permanent ×2 to all production, and −0.02 to every generator cost growth.',
    baseCost: dec(750_000),
    costMultiplier: 3.5,
    group: 'production',
    effects: [
      { kind: 'globalMult', value: 2 },
      { kind: 'costGrowthDelta', value: -0.02 },
    ],
  },
  {
    id: 'enterpriseContract',
    name: 'Enterprise Contract',
    description: 'Permanent ×2.5 to all production, ×1.5 to revenue, and costs ×0.7.',
    baseCost: dec(2_000_000),
    costMultiplier: 3.5,
    group: 'production',
    effects: [
      { kind: 'globalMult', value: 2.5 },
      { kind: 'revenueMult', value: 1.5 },
      { kind: 'costDiscount', value: 0.7 },
    ],
  },
];

const BY_ID = new Map<PermUpgradeId, PermUpgradeDef>(PERM_UPGRADE_DEFS.map((u) => [u.id, u]));

export function permUpgradeDef(id: PermUpgradeId): PermUpgradeDef | undefined {
  return BY_ID.get(id);
}

/** Tech Debt cost of the *next* level of a permanent upgrade. */
export function permUpgradeCost(state: GameState, id: PermUpgradeId): Decimal {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown permanent upgrade: ${id}`);
  const owned = state.prestige.permanentUpgrades[id] ?? 0;
  return def.baseCost.times(Decimal.pow(dec(def.costMultiplier), owned));
}

/**
 * Permanent global production factor, kept as its own accessor because the
 * prestige UI reports it and the balance sim asserts on it.
 */
export function permanentGlobalMult(state: GameState): Decimal {
  return applyPermanentEffects(state, 'globalMult');
}

/** Permanent generator-cost factor. */
export function permanentCostMult(state: GameState): Decimal {
  return applyPermanentEffects(state, 'costDiscount');
}

/**
 * Apply every level of a single effect kind across all owned permanent upgrades.
 * Effects of other kinds are ignored.
 */
export function applyPermanentEffects(state: GameState, kind: string): Decimal {
  let result = ONE;
  for (const def of PERM_UPGRADE_DEFS) {
    const owned = state.prestige.permanentUpgrades[def.id] ?? 0;
    if (owned <= 0) continue;
    for (const effect of def.effects) {
      if (effect.kind !== kind) continue;
      result = result.times(Decimal.pow(dec(effect.value), owned));
    }
  }
  return result;
}
