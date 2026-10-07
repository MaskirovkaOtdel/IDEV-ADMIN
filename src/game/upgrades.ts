/**
 * Foundational upgrades with unlock conditions and multiplicative boosts.
 *
 * Each upgrade has a cost (resource + amount), optional requirements, and a list
 * of effects. Every effect `value` is a MULTIPLICATIVE FACTOR (1.25 = +25%,
 * 0.88 = 12% off) so stacking is always unambiguous.
 *
 * `requires` gates are AND-ed and all checked by `meetsUpgradeRequirements`
 * in conditions.ts, which the store and the UI both use.
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
];

const BY_ID = new Map<UpgradeId, UpgradeDef>(UPGRADE_DEFS.map((u) => [u.id, u]));

export function upgradeDef(id: UpgradeId): UpgradeDef | undefined {
  return BY_ID.get(id);
}
