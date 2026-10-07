/**
 * Seven developer-themed generators with base costs, growth rates, and production.
 *
 * Order is intentionally themed: junior through to a fleet of autonomous agents.
 * Each generator outputs a specific ResourceId.
 *
 * BALANCE NOTES
 * -------------
 * `baseCost` is the price of the FIRST unit (owned = 0), i.e. the marginal cost
 * of the next purchase is baseCost * costGrowth^owned. This keeps the displayed
 * number and the geometric-series formula consistent.
 *
 * Rates are deliberately spread across ~40x per tier so that later generators feel
 * like upgrades rather than colour changes. Cost growth rises with tier so the
 * "buy a hundred of them" strategy stays relevant but never trivial.
 */
import type { GeneratorId, GeneratorDef, ResourceId } from './types';
import { dec } from './decimal';

export const GENERATOR_DEFS: GeneratorDef[] = [
  {
    id: 'juniorDev',
    name: 'Junior Dev',
    icon: '👨‍💻',
    flavor: 'Writes spaghetti that kinda works.',
    produces: 'cash',
    baseCost: dec(10),
    costGrowth: 1.12,
    baseRate: dec(0.2), // 0.2 cash/sec at owned=1
    unlockAt: { lifetimeCash: dec(0) },
  },
  {
    id: 'seniorDev',
    name: 'Senior Dev',
    icon: '🧑‍💻',
    flavor: 'Refactors "later" into maintainable junk.',
    produces: 'cash',
    baseCost: dec(150),
    costGrowth: 1.13,
    baseRate: dec(1.2),
    unlockAt: { lifetimeCash: dec(400) },
  },
  {
    id: 'codeReview',
    name: 'Code Review',
    icon: '👁‍🗨️',
    flavor: 'Approves pull requests and adds +1 complexity.',
    produces: 'linesOfCode',
    baseCost: dec(600),
    costGrowth: 1.14,
    baseRate: dec(1.5),
    unlockAt: { lifetimeCash: dec(2_500) },
  },
  {
    id: 'linter',
    name: 'Linter',
    icon: '🔍',
    flavor: 'Catches bugs the junior devs forgot to avoid.',
    produces: 'linesOfCode',
    baseCost: dec(2_500),
    costGrowth: 1.15,
    baseRate: dec(6),
    unlockAt: { lifetimeCash: dec(15_000) },
  },
  {
    id: 'testSuite',
    name: 'Test Suite',
    icon: '✅',
    flavor: '95% coverage and counting — slowly.',
    produces: 'coffee',
    baseCost: dec(6_000),
    costGrowth: 1.15,
    baseRate: dec(2.5),
    unlockAt: { lifetimeCash: dec(60_000) },
  },
  {
    id: 'ciPipeline',
    name: 'CI/CD Pipeline',
    icon: '🚀',
    flavor: 'Automated builds, occasional midnight fire drills.',
    produces: 'coffee',
    baseCost: dec(20_000),
    costGrowth: 1.16,
    baseRate: dec(10),
    unlockAt: { lifetimeCash: dec(250_000) },
  },
  {
    id: 'k8sCluster',
    name: 'K8s Cluster',
    icon: '☸️',
    flavor: 'Containers that auto-scale until the bill arrives.',
    produces: 'cash',
    baseCost: dec(75_000),
    costGrowth: 1.17,
    baseRate: dec(45),
    unlockAt: { lifetimeCash: dec(1_000_000) },
  },
];

/**
 * Find a generator definition by id (used by engine & UI).
 *
 * Takes a plain string because ids can arrive from saves, the debug panel and
 * tests; an unknown id yields `undefined` rather than throwing, so one bad id can
 * never take the game down mid-frame.
 */
export function genDef(id: string): GeneratorDef | undefined {
  return GENERATOR_DEFS.find((g) => g.id === id);
}

/** Find a generator definition by id, or fail loudly. Use in trusted paths. */
export function requireGenDef(id: GeneratorId): GeneratorDef {
  const found = genDef(id);
  if (!found) throw new Error(`Unknown generator id: ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// Revenue conversion: stockpiled LoC and Coffee turn into Cash every second.
// This is what gives the two side resources a purpose and links the three
// economies together, instead of leaving them as dead-end counters.
// ---------------------------------------------------------------------------

/** Cash per second, per LoC held. */
export const REVENUE_PER_LOC = 0.05;
/** Cash per second, per Coffee held. */
export const REVENUE_PER_COFFEE = 0.35;

/** Resource produced by each generator, as a lookup for the UI. */
export const GENERATOR_PRODUCES: Record<GeneratorId, ResourceId> = {
  juniorDev: 'cash',
  seniorDev: 'cash',
  codeReview: 'linesOfCode',
  linter: 'linesOfCode',
  testSuite: 'coffee',
  ciPipeline: 'coffee',
  k8sCluster: 'cash',
};
