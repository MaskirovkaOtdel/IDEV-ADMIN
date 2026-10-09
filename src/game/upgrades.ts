/**
 * Foundational upgrades with unlock conditions and multiplicative boosts.
 *
 * Each upgrade has a cost (resource + amount), optional requirements, and a list
 * of effects. Every effect `value` is a MULTIPLICATIVE FACTOR (1.25 = +25%,
 * 0.88 = 12% off) so stacking is always unambiguous.
 *
 * `requires` gates are AND-ed and all checked by `meetsUpgradeRequirements`
 * in conditions.ts, which the store and the UI both use.
 *
 * ---------------------------------------------------------------------------
 * SIZING POOL-GATED COSTS
 * ---------------------------------------------------------------------------
 * LoC and Coffee are sinks, not walls. They never drain on their own, so a pool
 * cost is always payable by waiting -- which is what keeps it an idle game rather
 * than a resource-management chore. Two rules follow, and both were violated by
 * the original six:
 *
 *   1. NEVER PRESSURE. A cost must never outrun inflow, because then the player
 *      has to choose between spending and losing income. The pools accumulate on
 *      their own, so anything is eventually payable.
 *
 *   2. NEVER TRIVIAL. The original pool costs were fractions of a second of
 *      production -- 150 LoC against ~2900/s is 0.05 seconds. That is why the
 *      pools read as decorative: spending one was not a decision.
 *
 * So pool costs here are sized in MINUTES TO HOURS of the inflow available at the
 * tier that unlocks them: long enough to be a real sink, short enough that waiting
 * is the answer. And never longer than a run, because a reset zeroes the pools --
 * an upgrade you cannot afford before your next prestige is a dead upgrade.
 *
 * Cash-gated costs use the same reasoning against cash income, and are the only
 * costs that can usefully be large, since cash carries across a reset.
 */
import type { UpgradeDef, UpgradeId } from './types';
import { dec } from './decimal';

export const UPGRADE_DEFS: UpgradeDef[] = [
  {
    id: 'codeMaster',
    name: 'Code Master',
    description: 'All production ×1.10.',
    cost: { resource: 'cash', amount: dec(50) },
    effects: [{ kind: 'globalMult', value: 1.1 }],
    group: 'production',
  },
  {
    id: 'styleGuide',
    name: 'Style Guide',
    description: 'Lines of Code production ×1.25.',
    cost: { resource: 'linesOfCode', amount: dec(150) },
    effects: [{ kind: 'resourceMult', target: 'linesOfCode', value: 1.25 }],
    group: 'production',
  },
  {
    id: 'testObsession',
    name: 'Test Obsession',
    description: 'Coffee production ×1.30.',
    cost: { resource: 'coffee', amount: dec(100) },
    effects: [{ kind: 'resourceMult', target: 'coffee', value: 1.3 }],
    group: 'production',
  },
  {
    id: 'pairProgramming',
    name: 'Pair Programming',
    description: 'Junior Dev production ×1.40. Requires 5 Junior Devs.',
    cost: { resource: 'cash', amount: dec(400) },
    requires: { generatorId: 'juniorDev', owned: 5 },
    effects: [{ kind: 'generatorMult', target: 'juniorDev', value: 1.4 }],
    group: 'production',
  },
  {
    id: 'freelanceContracts',
    name: 'Freelance Contracts',
    description: 'Revenue from stockpiled LoC and Coffee ×1.50.',
    cost: { resource: 'linesOfCode', amount: dec(400) },
    effects: [{ kind: 'revenueMult', value: 1.5 }],
    group: 'economy',
  },
  {
    id: 'automatedLinting',
    name: 'Automated Linting',
    description: 'Linter production ×2 and all generator costs −12%. Requires 3 Linters.',
    cost: { resource: 'linesOfCode', amount: dec(500) },
    requires: { generatorId: 'linter', owned: 3 },
    effects: [
      { kind: 'generatorMult', target: 'linter', value: 2 },
      { kind: 'costDiscount', value: 0.88 },
    ],
    group: 'production',
  },
  {
    id: 'continuousIntegration',
    name: 'Continuous Integration',
    description: 'CI/CD Pipeline production ×2. Requires 2 CI/CD Pipelines.',
    cost: { resource: 'cash', amount: dec(8_000) },
    requires: { generatorId: 'ciPipeline', owned: 2 },
    effects: [{ kind: 'generatorMult', target: 'ciPipeline', value: 2 }],
    group: 'production',
  },
  {
    id: 'seniorMentor',
    name: 'Senior Mentor',
    description: 'Senior Dev production ×2. Requires 50k lifetime cash.',
    cost: { resource: 'cash', amount: dec(25_000) },
    requires: { lifetimeCash: dec(50_000) },
    effects: [{ kind: 'generatorMult', target: 'seniorDev', value: 2 }],
    group: 'production',
  },
  {
    id: 'aiCopilot',
    name: 'AI Copilot Fleet',
    description: 'All production ×1.35. Requires 10 Code Reviews.',
    cost: { resource: 'linesOfCode', amount: dec(20_000) },
    requires: { generatorId: 'codeReview', owned: 10 },
    effects: [{ kind: 'globalMult', value: 1.35 }],
    group: 'production',
  },
  {
    id: 'refactorBot',
    name: 'Refactor Bot',
    description: 'Every generator cost growth −0.01 (e.g. 1.15 → 1.14). Requires 1M lifetime LoC.',
    cost: { resource: 'linesOfCode', amount: dec(75_000) },
    requires: { totalLinesMined: dec(1_000_000) },
    effects: [{ kind: 'costGrowthDelta', value: -0.01 }],
    group: 'economy',
  },
  {
    id: 'quantumServer',
    name: 'Quantum Server',
    description: 'K8s Cluster production ×3. Requires 1 K8s Cluster.',
    cost: { resource: 'cash', amount: dec(500_000) },
    requires: { generatorId: 'k8sCluster', owned: 1 },
    effects: [{ kind: 'generatorMult', target: 'k8sCluster', value: 3 }],
    group: 'production',
  },
  {
    id: 'autonomousAgent',
    name: 'Autonomous Agent',
    description: 'All production ×1.25 permanently. Requires 10M lifetime cash.',
    cost: { resource: 'cash', amount: dec(2_000_000) },
    requires: { lifetimeCash: dec(10_000_000) },
    effects: [{ kind: 'globalMult', value: 1.25 }],
    group: 'production',
  },

  // -------------------------------------------------------------------------
  // Tier 2 — unlocked by generator count.
  //
  // These pace themselves: you cannot rush them, because the gate is how many you
  // have hired rather than how much you have saved. That is deliberate — the point
  // is that the team grows into its next upgrade.
  // -------------------------------------------------------------------------
  {
    id: 'standUp',
    name: 'Daily Standup',
    description: 'Junior Dev production ×1.5. Requires 25 Junior Devs.',
    cost: { resource: 'cash', amount: dec(25_000) },
    requires: { generatorId: 'juniorDev', owned: 25 },
    effects: [{ kind: 'generatorMult', target: 'juniorDev', value: 1.5 }],
    group: 'production',
  },
  {
    id: 'techDebtRelief',
    name: 'Tech Debt Relief Fund',
    description: 'All production ×1.20. Requires 40 Senior Devs.',
    cost: { resource: 'cash', amount: dec(600_000) },
    requires: { generatorId: 'seniorDev', owned: 40 },
    effects: [{ kind: 'globalMult', value: 1.2 }],
    group: 'production',
  },
  {
    id: 'rubberDuckReview',
    name: 'Rubber Duck Reviews',
    description: 'Code Review production ×2. Requires 30 Code Reviews.',
    cost: { resource: 'cash', amount: dec(400_000) },
    requires: { generatorId: 'codeReview', owned: 30 },
    effects: [{ kind: 'generatorMult', target: 'codeReview', value: 2 }],
    group: 'production',
  },
  {
    id: 'styleGuideSecondEdition',
    name: 'Style Guide, Second Edition',
    description: 'Lines of Code production ×1.60. Requires 25 Linters.',
    cost: { resource: 'linesOfCode', amount: dec(400_000) },
    requires: { generatorId: 'linter', owned: 25 },
    effects: [{ kind: 'resourceMult', target: 'linesOfCode', value: 1.6 }],
    group: 'production',
  },
  {
    id: 'flakyTestWhisperer',
    name: 'Flaky Test Whisperer',
    description: 'Coffee production ×1.75. Requires 20 Test Suites.',
    cost: { resource: 'coffee', amount: dec(250_000) },
    requires: { generatorId: 'testSuite', owned: 20 },
    effects: [{ kind: 'resourceMult', target: 'coffee', value: 1.75 }],
    group: 'production',
  },
  {
    id: 'pipelineTemplates',
    name: 'Pipeline Templates',
    description: 'CI/CD Pipeline production ×2.25. Requires 15 CI/CD Pipelines.',
    cost: { resource: 'cash', amount: dec(1_200_000) },
    requires: { generatorId: 'ciPipeline', owned: 15 },
    effects: [{ kind: 'generatorMult', target: 'ciPipeline', value: 2.25 }],
    group: 'production',
  },
  {
    id: 'autoscalingPolicy',
    name: 'Autoscaling Policy',
    description: 'K8s Cluster production ×1.8 and all generator costs −6%. Requires 8 K8s Clusters.',
    cost: { resource: 'cash', amount: dec(2_500_000) },
    requires: { generatorId: 'k8sCluster', owned: 8 },
    effects: [
      { kind: 'generatorMult', target: 'k8sCluster', value: 1.8 },
      { kind: 'costDiscount', value: 0.94 },
    ],
    group: 'economy',
  },

  // -------------------------------------------------------------------------
  // Tier 3 — pool-gated, and the reason LoC and Coffee exist.
  //
  // Sized against inflow at the tier that unlocks them, in minutes rather than
  // the fractions of a second the first six used. See the header note: these are
  // sinks, never walls.
  // -------------------------------------------------------------------------
  {
    id: 'monorepoMigrationRun',
    name: 'Monorepo Migration',
    description: 'LoC production ×1.45. Requires 25 Code Reviews.',
    cost: { resource: 'linesOfCode', amount: dec(300_000) },
    requires: { generatorId: 'codeReview', owned: 25 },
    effects: [{ kind: 'resourceMult', target: 'linesOfCode', value: 1.45 }],
    group: 'production',
  },
  {
    id: 'contractorsSafe',
    name: 'Contractors’ Safe',
    description: 'Revenue from stockpiled LoC and Coffee ×1.40. Requires 15 Test Suites.',
    cost: { resource: 'coffee', amount: dec(150_000) },
    requires: { generatorId: 'testSuite', owned: 15 },
    effects: [{ kind: 'revenueMult', value: 1.4 }],
    group: 'economy',
  },
  {
    id: 'incidentResponse',
    name: 'Incident Response rota',
    description: 'Coffee production ×1.60 and offline efficiency +25%. Requires 12 CI/CD Pipelines.',
    cost: { resource: 'coffee', amount: dec(260_000) },
    requires: { generatorId: 'ciPipeline', owned: 12 },
    effects: [
      { kind: 'resourceMult', target: 'coffee', value: 1.6 },
      { kind: 'offlineEfficiency', value: 1.25 },
    ],
    group: 'economy',
  },
  {
    id: 'testCoveragePush',
    name: 'Test Coverage Push',
    description: 'All production ×1.30. Requires 20 Linters.',
    cost: { resource: 'linesOfCode', amount: dec(520_000) },
    requires: { generatorId: 'linter', owned: 20 },
    effects: [{ kind: 'globalMult', value: 1.3 }],
    group: 'production',
  },
  {
    id: 'vendorNegotiation',
    name: 'Vendor Negotiation',
    description: 'All generator costs −15% and cost growth −0.01. Requires 50 Senior Devs.',
    cost: { resource: 'cash', amount: dec(5_000_000) },
    requires: { generatorId: 'seniorDev', owned: 50 },
    effects: [
      { kind: 'costDiscount', value: 0.85 },
      { kind: 'costGrowthDelta', value: -0.01 },
    ],
    group: 'economy',
  },

  // -------------------------------------------------------------------------
  // Tier 4 — the late-run tail, so the panel stays alive at high scale.
  //
  // Cash-gated, because cash is the only resource that survives a reset. A
  // pool-gated upgrade late in a run would be unreachable: the pools are zeroed
  // by the prestige that funds the rest of the tree.
  // -------------------------------------------------------------------------
  {
    id: 'platformGuild',
    name: 'Platform Guild',
    description: 'All production ×1.40. Requires 100M lifetime cash.',
    cost: { resource: 'cash', amount: dec(20_000_000) },
    requires: { lifetimeCash: dec(100_000_000) },
    effects: [{ kind: 'globalMult', value: 1.4 }],
    group: 'production',
  },
  {
    id: 'distributedTeam',
    name: 'Distributed Team',
    description: 'All production ×1.50 and generator cost growth −0.02. Requires 1B lifetime cash.',
    cost: { resource: 'cash', amount: dec(120_000_000) },
    requires: { lifetimeCash: dec(1_000_000_000) },
    effects: [
      { kind: 'globalMult', value: 1.5 },
      { kind: 'costGrowthDelta', value: -0.02 },
    ],
    group: 'production',
  },
  {
    id: 'sovereignCloud',
    name: 'Sovereign Cloud',
    description: 'All production ×1.75. Requires 10B lifetime cash.',
    cost: { resource: 'cash', amount: dec(800_000_000) },
    requires: { lifetimeCash: dec(10_000_000_000) },
    effects: [{ kind: 'globalMult', value: 1.75 }],
    group: 'production',
  },
];

const BY_ID = new Map<UpgradeId, UpgradeDef>(UPGRADE_DEFS.map((u) => [u.id, u]));

export function upgradeDef(id: UpgradeId): UpgradeDef | undefined {
  return BY_ID.get(id);
}
