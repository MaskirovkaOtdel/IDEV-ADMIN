/**
 * Core TypeScript types for IDEV : ADMIN.
 *
 * All numeric values that may exceed 1e308 are represented as break_infinity.js Decimal.
 * Multipliers are computed from state, never stored directly.
 */
import Decimal from 'break_infinity.js';

export type ResourceId = 'linesOfCode' | 'coffee' | 'cash';

export type GeneratorId =
  | 'juniorDev'
  | 'seniorDev'
  | 'codeReview'
  | 'linter'
  | 'testSuite'
  | 'ciPipeline'
  | 'k8sCluster';

export type UpgradeId = string;
export type PermUpgradeId = string;

export const RESOURCE_IDS: readonly ResourceId[] = ['linesOfCode', 'coffee', 'cash'] as const;

export const GENERATOR_IDS: readonly GeneratorId[] = [
  'juniorDev',
  'seniorDev',
  'codeReview',
  'linter',
  'testSuite',
  'ciPipeline',
  'k8sCluster',
] as const;

export const RESOURCE_LABELS: Record<ResourceId, string> = {
  linesOfCode: 'LoC',
  coffee: 'Coffee',
  cash: 'Cash',
};

// ---------------------------------------------------------------------------
// ResourceState holds the current quantity of each resource.
// ---------------------------------------------------------------------------
export interface ResourceState {
  linesOfCode: Decimal;
  coffee: Decimal;
  cash: Decimal;
  /** Gross lifetime cash ever earned, across all runs. Survives prestige. */
  lifetimeCash: Decimal;
}

// ---------------------------------------------------------------------------
// GeneratorState tracks ownership count and unlock status per generator.
// ---------------------------------------------------------------------------
export interface GeneratorState {
  owned: number;          // integer count owned
  unlocked: boolean;      // whether the generator type is unlocked
}

export type GeneratorMap = Record<GeneratorId, GeneratorState>;

// ---------------------------------------------------------------------------
// MultiplierSnapshot is derived from upgrades + generators + prestige each tick.
// It is NOT serialized; only the raw counts are saved.
// ---------------------------------------------------------------------------
export interface MultiplierSnapshot {
  /** product of all global production multipliers */
  global: Decimal;
  /** per-resource production multipliers */
  perResource: Record<ResourceId, Decimal>;
  /** per-generator production multipliers */
  perGenerator: Record<GeneratorId, Decimal>;
  /** cost discount factor (1 = full price, 0.9 = 10% off, etc.) */
  costDiscount: Decimal;
  /** additive delta applied to every costGrowth (e.g. -0.01 makes 1.15 -> 1.14) */
  costGrowthDelta: number;
  /** multiplicative factor applied to revenue-per-unit (LoC/coffee -> cash) */
  revenueMult: Decimal;
  /** multiplicative factor applied to offline efficiency */
  offlineEfficiency: Decimal;
}

// ---------------------------------------------------------------------------
// ProductionSnapshot is what the engine returns from a tick so the UI can show
// per-resource rates without recomputing anything.
// ---------------------------------------------------------------------------
export interface ProductionSnapshot {
  /** production per second, per resource */
  perResource: Record<ResourceId, Decimal>;
  /** production per second, per generator (includes every multiplier) */
  perGenerator: Record<GeneratorId, Decimal>;
  /** revenue per second, derived from stockpiled LoC + coffee */
  revenuePerSec: Decimal;
  /** cash per second in total (generator production + revenue) */
  cashPerSec: Decimal;
}

// ---------------------------------------------------------------------------
// RunStats accumulates play metrics for the current run and for all time.
// ---------------------------------------------------------------------------
export interface RunStats {
  playSeconds: number;
  /** cash earned this run */
  runCashEarned: Decimal;
  /** cash earned across all runs (survives prestige) */
  totalCashEarned: Decimal;
  /** LoC produced across all runs (survives prestige) */
  totalLinesMined: Decimal;
  manualClicks: number;
  /** number of prestige resets performed */
  prestigeCount: number;
}

// ---------------------------------------------------------------------------
// PrestigeState is the permanent progression layer ("Tech Debt").
// ---------------------------------------------------------------------------
export interface PrestigeState {
  /** prestige currency "Tech Debt", starts at 0 */
  techDebt: Decimal;
  /** permanent multiplier upgrades purchased, id -> times owned */
  permanentUpgrades: Record<PermUpgradeId, number>;
  /** lifetime Tech Debt earned (never decreases; for the UI and stats) */
  totalTechDebtEarned: Decimal;
  /** highest lifetimeCash reached at the moment of a reset */
  bestRunLifetimeCash: Decimal;
  /**
   * lifetimeCash already converted into Tech Debt by a previous reset.
   *
   * The payout is computed from `lifetimeCash - baseline`, not from lifetimeCash
   * itself. Without this, a reset preserves lifetimeCash, so the player could
   * prestige repeatedly with zero progress and farm Tech Debt forever.
   */
  baselineLifetimeCash: Decimal;
}

// ---------------------------------------------------------------------------
// The full game state. Version bumps when the save-schema changes.
// ---------------------------------------------------------------------------
export interface GameState {
  /** Schema version — bump when serialization format changes. */
  version: number;
  resources: ResourceState;
  generators: GeneratorMap;
  upgrades: UpgradeState;
  stats: RunStats;
  prestige: PrestigeState;
  /** epoch ms of the last processed tick (offline seed). */
  lastTickAt: number;
  /** monotonically increased each tick, drives UI re-renders. */
  tickVersion: number;
}

export interface UpgradeState {
  purchased: UpgradeId[];
}

// ---------------------------------------------------------------------------
// GeneratorDef describes a generator's static configuration.
// ---------------------------------------------------------------------------
export interface GeneratorDef {
  id: GeneratorId;
  name: string;
  icon: string;
  flavor: string;
  produces: ResourceId;           // which resource this generator outputs
  baseCost: Decimal;              // cost of the first unit
  costGrowth: number;             // multiplicative factor per owned unit (e.g. 1.15)
  baseRate: Decimal;              // output per second at owned=1, *before* multipliers
  unlockAt: { lifetimeCash: Decimal };
}

// ---------------------------------------------------------------------------
// UpgradeDef defines a one-time purchase and its production effect.
//
// Every `value` is a MULTIPLICATIVE FACTOR, never an additive delta:
//   • a 10% production boost is 1.1
//   • a 12% discount is 0.88
// This keeps stacking unambiguous (`1.1 * 1.2 === 1.32`).
// ---------------------------------------------------------------------------
export type UpgradeEffectKind =
  | 'globalMult'
  | 'resourceMult'
  | 'generatorMult'
  | 'revenueMult'
  | 'costDiscount'
  | 'costGrowthDelta'
  /** Multiplies offline efficiency (1.5 = offline runs at 75% instead of 50%). */
  | 'offlineEfficiency';

export interface UpgradeRequirement {
  generatorId?: GeneratorId;
  owned?: number;
  lifetimeCash?: Decimal;
  totalLinesMined?: Decimal;
  /** every listed upgrade must already be purchased */
  upgrades?: UpgradeId[];
}

export interface UpgradeEffect {
  kind: UpgradeEffectKind;
  /** Target generator or resource, if applicable. */
  target?: GeneratorId | ResourceId;
  /** Multiplicative factor (2 = ×2, 0.9 = 10% off). */
  value: number;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
  /** Cost to purchase, expressed as a resource requirement. */
  cost: { resource: ResourceId; amount: Decimal };
  /** Optional requirements before this upgrade can be bought. */
  requires?: UpgradeRequirement;
  /** Effects applied when the upgrade is purchased. Stacked multiplicatively. */
  effects: UpgradeEffect[];
  /** Grouping used by the UI. */
  group?: 'production' | 'economy' | 'unlocks';
}

// ---------------------------------------------------------------------------
// PermUpgradeDef is a prestige-layer upgrade bought with Tech Debt.
// ---------------------------------------------------------------------------
export interface PermUpgradeDef {
  id: PermUpgradeId;
  name: string;
  description: string;
  /** Tech Debt cost of the first purchase. */
  baseCost: Decimal;
  /** every repeat purchase multiplies the cost by this factor. */
  costMultiplier: number;
  /**
   * Effects granted per purchase. Uses the same kinds as run upgrades, so the
   * permanent layer can target generators and resources rather than only
   * nudging a single global number — which is what makes repeated prestiges
   * feel like different runs rather than the same one with a bigger number.
   */
  effects: UpgradeEffect[];
  /** Grouping used by the UI. */
  group?: 'production' | 'economy' | 'convenience';
}

// ---------------------------------------------------------------------------
// SaveBlob is the exact shape written to localStorage. Every Decimal is stored
// as a plain string so JSON round-trips cleanly.
// ---------------------------------------------------------------------------
export interface SaveBlob {
  version: number;
  savedAt: number;
  resources: Record<ResourceId, string> & { lifetimeCash: string };
  generators: Record<GeneratorId, number>;
  upgrades: string[];
  stats: {
    playSeconds: number;
    manualClicks: number;
    prestigeCount: number;
    runCashEarned: string;
    totalCashEarned: string;
    totalLinesMined: string;
  };
  prestige: {
    techDebt: string;
    totalTechDebtEarned: string;
    permanentUpgrades: Record<string, number>;
    bestRunLifetimeCash: string;
    baselineLifetimeCash: string;
  };
  lastTickAt: number;
  tickVersion: number;
}

// ---------------------------------------------------------------------------
// OfflineReport is what we return to the UI when the player returns after being away.
// ---------------------------------------------------------------------------
export interface OfflineReport {
  /** raw time away in seconds (uncapped) */
  elapsedSeconds: number;
  /** elapsed after the 8h cap, before efficiency */
  cappedSeconds: number;
  /** capped * the efficiency that was in force (0.5 base, raised by perm upgrades) */
  effectiveSeconds: number;
  /** the efficiency used, so the UI never has to recompute or guess it */
  efficiency: number;
  /** resources actually credited */
  gained: Partial<Record<ResourceId, Decimal>>;
  /** true when nothing was credited (too short an absence, or nothing owned) */
  trivial: boolean;
}
