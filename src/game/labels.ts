/**
 * Display names for ids.
 *
 * Kept separate from `generators.ts` so `conditions.ts` can produce a readable
 * requirement message ("Requires 2 × CI/CD Pipeline") without importing the
 * generator definitions into every caller.
 */
import type { GeneratorId, ResourceId } from './types';

export const GENERATOR_NAMES: Record<GeneratorId, string> = {
  juniorDev: 'Junior Dev',
  seniorDev: 'Senior Dev',
  codeReview: 'Code Review',
  linter: 'Linter',
  testSuite: 'Test Suite',
  ciPipeline: 'CI/CD Pipeline',
  k8sCluster: 'K8s Cluster',
};

export const RESOURCE_NAMES: Record<ResourceId, string> = {
  linesOfCode: 'LoC',
  coffee: 'Coffee',
  cash: 'Cash',
};

export const RESOURCE_UNITS: Record<ResourceId, string> = {
  linesOfCode: 'LoC',
  coffee: 'coffee',
  cash: 'cash',
};
