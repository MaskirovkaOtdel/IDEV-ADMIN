/**
 * Balance simulator — measures how long the economy actually takes to progress.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 45–60 minute "first meaningful prestige" target was previously "verified"
 * by a test that only asserted the Tech Debt *formula* was monotonic. That proves
 * the curve is shaped correctly; it says nothing about whether a player can reach
 * it. This simulator answers the real question: given a competent play policy, how
 * much wall-clock time elapses before each milestone?
 *
 * It drives the real engine, real cost curve, and real multipliers — no React,
 * no store, no localStorage. Any change to the economy moves these numbers, so
 * `npm run simulate` is the before/after evidence CONTRIBUTING.md asks for.
 *
 * USAGE
 *   npm run simulate                # both player profiles, summary table
 *   npm run simulate -- --hours 6   # extend the horizon
 *   npm run simulate -- --json      # machine-readable output
 */

import { engineTick } from '../src/game/engine';
import { costForBulkPurchase, effectiveCostGrowth } from '../src/game/formulas';
import { computeMultipliers } from '../src/game/multipliers';
import { GENERATOR_DEFS, genDef } from '../src/game/generators';
import { UPGRADE_DEFS, upgradeDef } from '../src/game/upgrades';
import { canAffordUpgrade, meetsUpgradeRequirements } from '../src/game/conditions';
import { computeTechDebtGained, lifetimeCashForTechDebt, resetForPrestige } from '../src/game/prestige';
import { PERM_UPGRADE_DEFS } from '../src/game/permUpgrades';
import { createInitialState } from '../src/game/serialize';
import { dec, ZERO } from '../src/game/decimal';
import type { GameState, GeneratorId, UpgradeId } from '../src/game/types';

// ---------------------------------------------------------------------------
// Simulation clock
// ---------------------------------------------------------------------------

/** Simulation step. Matches the live loop's clamp so numbers are comparable. */
const TICK_SECONDS = 0.1;

/**
 * Player profiles.
 *
 * Active play and idle play diverge by an order of magnitude in an idle game, so
 * measuring only one of them produces a number that is true for nobody. The
 * tuning target applies to `active`; `idle` is reported as a reference curve.
 */
export interface Profile {
  id: string;
  label: string;
  /** Seconds between purchase decisions. Null means "only buy at the very end". */
  buyEverySeconds: number | null;
  description: string;
}

export const PROFILES: Profile[] = [
  {
    id: 'active',
    label: 'Active',
    buyEverySeconds: 5,
    description: 'buys every 5s — the tuning target',
  },
  {
    id: 'idle',
    label: 'Idle',
    buyEverySeconds: 30,
    description: 'checks in every 30s — reference curve',
  },
];

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export interface Milestone {
  label: string;
  kind: 'unlock' | 'upgrade' | 'currency' | 'prestige';
  /** Wall-clock seconds from game start. */
  atSeconds: number;
  detail: string;
}

export interface SimulationResult {
  profile: Profile;
  /** Total simulated time. */
  horizonSeconds: number;
  milestones: Milestone[];
  /** Time to the first permanent Tech Debt tier, or null if never reached. */
  timeToFirstTierSeconds: number | null;
  /** Final unbanked lifetime cash (what a reset would pay out on). */
  finalLifetimeCash: number;
  finalTechDebtIfReset: number;
  /** Generators owned at the end. */
  finalOwned: number;
  upgradesPurchased: number;
  upgradesTotal: number;
  /** Cash production per second at the end. */
  finalCashPerSec: number;
  totalPrestiges: number;
}

/** Unbanked cash needed for the first permanent Tech Debt tier. */
const FIRST_TIER_UNBANKED = Number(PERM_UPGRADE_DEFS[0].baseCost.toString());

/** Currency milestones worth reporting. */
const CURRENCY_MILESTONES = [
  1e3, 1e4, 1e5, 2.75e5, 1e6, 1e7, 1e8, 1e9, 1e12,
];

// ---------------------------------------------------------------------------
// Play policy
// ---------------------------------------------------------------------------

/** Buy an upgrade if it is legal and affordable. Returns true if one was bought. */
function tryBuyUpgrade(state: GameState): boolean {
  for (const def of UPGRADE_DEFS) {
    if (state.upgrades.purchased.includes(def.id)) continue;
    if (!meetsUpgradeRequirements(state, def).met) continue;
    if (!canAffordUpgrade(state, def)) continue;

    state.upgrades.purchased.push(def.id);
    state.resources[def.cost.resource] = state.resources[def.cost.resource].minus(def.cost.amount);
    return true;
  }
  return false;
}

/**
 * Cash payback of one unit of a generator, in seconds.
 *
 * This is the standard idle-game efficiency metric: what you gain per second
 * divided by what you pay. Dividing by cost (rather than comparing raw rates)
 * is what makes a cheap generator compete with an expensive one.
 */
function paybackSeconds(state: GameState, id: GeneratorId): number {
  const def = genDef(id);
  if (!def) return Infinity;

  const mult = computeMultipliers(state);
  const growth = effectiveCostGrowth(def.costGrowth, mult.costGrowthDelta);

  const unitCost = costForBulkPurchase(def.baseCost, growth, state.generators[id].owned, 1, mult.costDiscount);
  if (unitCost.lessThanOrEqualTo(ZERO)) return 0;

  // Revenue generators are worth their cash-equivalent, not their raw output.
  const rawRate = def.baseRate
    .times(mult.perGenerator[id])
    .times(mult.perResource[def.produces])
    .times(mult.global);

  const cashEquivalent =
    def.produces === 'cash'
      ? rawRate
      : def.produces === 'linesOfCode'
        ? rawRate.times(0.05).times(mult.revenueMult)
        : rawRate.times(0.35).times(mult.revenueMult);

  const cost = Number(unitCost.toString());
  if (!Number.isFinite(cost) || cost <= 0) return Infinity;
  const rate = Number(cashEquivalent.toString());
  if (!Number.isFinite(rate) || rate <= 0) return Infinity;

  return cost / rate;
}

/** Buy the unlocked generator with the best cash payback, if affordable. */
function tryBuyGenerator(state: GameState): boolean {
  const mult = computeMultipliers(state);
  let best: GeneratorId | null = null;
  let bestPayback = Infinity;

  for (const def of GENERATOR_DEFS) {
    if (!state.generators[def.id].unlocked) continue;
    const payback = paybackSeconds(state, def.id);
    if (payback < bestPayback) {
      bestPayback = payback;
      best = def.id;
    }
  }

  if (!best) return false;

  const def = genDef(best);
  if (!def) return false;

  const growth = effectiveCostGrowth(def.costGrowth, mult.costGrowthDelta);
  const genState = state.generators[best];
  const cost = costForBulkPurchase(def.baseCost, growth, genState.owned, 1, mult.costDiscount);

  if (state.resources.cash.lessThan(cost)) return false;

  genState.owned += 1;
  state.resources.cash = state.resources.cash.minus(cost);
  return true;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * Play a full run under a profile and report when each milestone was reached.
 *
 * The policy is deliberately simple and deterministic: buy the cheapest legal
 * upgrade first, then the generator with the best cash payback. It is not
 * optimal play, which is the point — a number derived from optimal play would
 * understate real progression time.
 */
export function simulate(profile: Profile, horizonHours: number): SimulationResult {
  const horizonSeconds = horizonHours * 3600;
  const state = createInitialState(0);
  const milestones: Milestone[] = [];
  let elapsed = 0;
  let nextBuyAt = profile.buyEverySeconds ?? Number.POSITIVE_INFINITY;

  // Track first-time events so each is reported once.
  const seenUnlocks = new Set<GeneratorId>();
  const seenUpgrades = new Set<UpgradeId>();
  const seenCurrency = new Set<number>();
  let timeToFirstTierSeconds: number | null = null;
  let totalPrestiges = 0;
  let lastLifetimeCash = 0;

  // Generators unlocked from the start are not "unlocked" milestones.
  for (const def of GENERATOR_DEFS) {
    if (state.generators[def.id].unlocked) seenUnlocks.add(def.id);
  }

  while (elapsed < horizonSeconds) {
    engineTick(state, TICK_SECONDS, elapsed * 1000);
    elapsed += TICK_SECONDS;

    // Purchase decisions.
    if (elapsed >= nextBuyAt) {
      if (profile.buyEverySeconds === null) {
        // One-shot profile: buy once, at the end of the run.
        nextBuyAt = Number.POSITIVE_INFINITY;
      } else {
        nextBuyAt = elapsed + profile.buyEverySeconds;
      }

      // Spend down on upgrades first (they are usually better value), then
      // reinvest remaining cash in generators.
      for (let i = 0; i < 12; i += 1) {
        if (!tryBuyUpgrade(state)) break;
      }
      for (let i = 0; i < 12; i += 1) {
        if (!tryBuyGenerator(state)) break;
      }
    }

    // New generator unlocks.
    for (const def of GENERATOR_DEFS) {
      if (state.generators[def.id].unlocked && !seenUnlocks.has(def.id)) {
        seenUnlocks.add(def.id);
        milestones.push({
          label: `${def.name} unlocked`,
          kind: 'unlock',
          atSeconds: elapsed,
          detail: `lifetime cash ${format(state.resources.lifetimeCash)}`,
        });
      }
    }

    // Upgrades actually purchased (they may become affordable between buys).
    for (const id of state.upgrades.purchased) {
      if (seenUpgrades.has(id)) continue;
      seenUpgrades.add(id);
      const def = upgradeDef(id);
      milestones.push({
        label: `Upgrade: ${def?.name ?? id}`,
        kind: 'upgrade',
        atSeconds: elapsed,
        detail: `cost ${def ? `${format(dec(Number(def.cost.amount.toString())))} ${def.cost.resource}` : '?'}`,
      });
    }

    // Currency thresholds.
    const lifetime = Number(state.resources.lifetimeCash.toString());
    if (Number.isFinite(lifetime)) {
      for (const threshold of CURRENCY_MILESTONES) {
        if (lifetime >= threshold && !seenCurrency.has(threshold)) {
          seenCurrency.add(threshold);
          const unbanked = lifetime - lastLifetimeCash;
          milestones.push({
            label: `${formatCurrency(threshold)} lifetime cash`,
            kind: 'currency',
            atSeconds: elapsed,
            detail: `${format(state.resources.lifetimeCash)} total`,
          });
          lastLifetimeCash = lifetime;
          void unbanked;
        }
      }

      // First permanent tier: the headline pacing target.
      if (timeToFirstTierSeconds === null) {
        const payout = Number(computeTechDebtGained(state).toString());
        if (payout >= FIRST_TIER_UNBANKED) {
          timeToFirstTierSeconds = elapsed;
          milestones.push({
            label: 'FIRST PERMANENT TIER affordable',
            kind: 'prestige',
            atSeconds: elapsed,
            detail: `${formatDuration(elapsed)} — Tech Debt ${payout}`,
          });
        }
      }
    }
  }

  const snapshot = computeMultipliers(state);
  void snapshot;
  const production = engineTick({ ...state }, 0, elapsed * 1000);

  return {
    profile,
    horizonSeconds,
    milestones,
    timeToFirstTierSeconds,
    finalLifetimeCash: Number(state.resources.lifetimeCash.toString()),
    finalTechDebtIfReset: Number(computeTechDebtGained(state).toString()),
    finalOwned: GENERATOR_DEFS.reduce((sum, d) => sum + state.generators[d.id].owned, 0),
    upgradesPurchased: state.upgrades.purchased.length,
    upgradesTotal: UPGRADE_DEFS.length,
    finalCashPerSec: Number(production.perResource.cash.toString()),
    totalPrestiges,
  };
}

/**
 * Multi-run: simulate a prestige-and-continue progression.
 *
 * The single-run number answers "how long to the first tier". This answers "how
 * long to each tier across a long session", which is the curve a player actually
 * climbs. Resets happen as soon as a tier is affordable.
 */
export function simulatePrestigeLadder(profile: Profile, horizonHours: number): {
  rows: { tier: string; atSeconds: number }[];
  finalPermOwned: number;
} {
  const horizonSeconds = horizonHours * 3600;
  let state = createInitialState(0);
  let elapsed = 0;
  let nextBuyAt = profile.buyEverySeconds ?? Number.POSITIVE_INFINITY;
  const rows: { tier: string; atSeconds: number }[] = [];
  const bought = new Set<string>();

  while (elapsed < horizonSeconds) {
    engineTick(state, TICK_SECONDS, elapsed * 1000);
    elapsed += TICK_SECONDS;

    if (elapsed >= nextBuyAt) {
      nextBuyAt = profile.buyEverySeconds === null
        ? Number.POSITIVE_INFINITY
        : elapsed + profile.buyEverySeconds;
      for (let i = 0; i < 12; i += 1) if (!tryBuyUpgrade(state)) break;
      for (let i = 0; i < 12; i += 1) if (!tryBuyGenerator(state)) break;
    }

    // Spend Tech Debt on permanent tiers whenever possible, cheapest first.
    let boughtSomething = true;
    while (boughtSomething) {
      boughtSomething = false;
      for (const def of PERM_UPGRADE_DEFS) {
        const owned = state.prestige.permanentUpgrades[def.id] ?? 0;
        const price = Number(def.baseCost.toString()) * Math.pow(def.costMultiplier, owned);
        if (state.prestige.techDebt.greaterThanOrEqualTo(dec(price))) {
          state.prestige.techDebt = state.prestige.techDebt.minus(dec(price));
          state.prestige.permanentUpgrades[def.id] = owned + 1;
          boughtSomething = true;
          if (!bought.has(`${def.id}:${owned}`)) {
            bought.add(`${def.id}:${owned}`);
            rows.push({ tier: `${def.name} ×${owned + 1}`, atSeconds: elapsed });
          }
        }
      }
    }

    // Reset only when the payout would actually buy a tier. Resetting on a fixed
    // threshold loops forever once that threshold is below the next tier's price:
    // you would reset every cycle, bank the same 25, and never progress.
    const payout = computeTechDebtGained(state);
    const nextTierPrice = PERM_UPGRADE_DEFS.reduce((sum, def) => {
      const owned = state.prestige.permanentUpgrades[def.id] ?? 0;
      return Math.min(sum, Number(def.baseCost.toString()) * Math.pow(def.costMultiplier, owned));
    }, Number.POSITIVE_INFINITY);

    const banked = state.prestige.techDebt.plus(payout);
    if (payout.greaterThan(ZERO) && banked.greaterThanOrEqualTo(dec(nextTierPrice))) {
      state = resetForPrestige(state, elapsed * 1000);
    }
  }

  const finalPermOwned = Object.values(state.prestige.permanentUpgrades).reduce((a, b) => a + b, 0);
  return { rows, finalPermOwned };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (value === 0) return '0';
  const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];
  let n = value;
  let tier = 0;
  while (Math.abs(n) >= 1000 && tier < units.length - 1) {
    n /= 1000;
    tier += 1;
  }
  const rounded = n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2);
  return `${rounded.replace(/\.0+$/, '').replace(/\.$/, '')}${units[tier]}`;
}

function format(value: { toString(): string }): string {
  return formatCurrency(Number(value.toString()));
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'never';
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export const TUNING_TARGET_MIN_SECONDS = 45 * 60;
export const TUNING_TARGET_MAX_SECONDS = 60 * 60;

function printProfile(result: SimulationResult): void {
  const p = result.profile;
  console.log(`\n${'='.repeat(72)}`);
  console.log(`  ${p.label} play — ${p.description}`);
  console.log('='.repeat(72));

  console.log('\n  Milestones');
  console.log(`  ${'when'.padEnd(12)}${'event'.padEnd(44)}detail`);
  console.log(`  ${'-'.repeat(11)}${'-'.repeat(44)}${'-'.repeat(28)}`);
  for (const m of result.milestones) {
    console.log(`  ${formatDuration(m.atSeconds).padEnd(12)}${m.label.padEnd(44)}${m.detail.slice(0, 28)}`);
  }

  console.log('\n  End of run');
  console.log(`    lifetime cash        ${formatCurrency(result.finalLifetimeCash)}`);
  console.log(`    cash/sec             ${formatCurrency(result.finalCashPerSec)}`);
  console.log(`    generators owned     ${result.finalOwned}`);
  console.log(`    upgrades             ${result.upgradesPurchased}/${result.upgradesTotal}`);
  console.log(`    Tech Debt on reset   ${result.finalTechDebtIfReset}`);

  console.log('\n  Pacing verdict');
  const t = result.timeToFirstTierSeconds;
  if (t === null) {
    console.log(`    First permanent tier NOT reached within ${formatDuration(result.horizonSeconds)}.`);
    console.log(`    Need ${formatCurrency(FIRST_TIER_UNBANKED)} unbanked lifetime cash.`);
  } else {
    const inWindow = t >= TUNING_TARGET_MIN_SECONDS && t <= TUNING_TARGET_MAX_SECONDS;
    const marker = inWindow ? 'ON TARGET' : t < TUNING_TARGET_MIN_SECONDS ? 'TOO FAST' : 'TOO SLOW';
    console.log(`    First permanent tier: ${formatDuration(t)}  [${marker}]`);
    console.log(`    Target window: ${formatDuration(TUNING_TARGET_MIN_SECONDS)} – ${formatDuration(TUNING_TARGET_MAX_SECONDS)}`);
    const needed = Number(lifetimeCashForTechDebt(FIRST_TIER_UNBANKED).toString());
    console.log(`    Requires ${formatCurrency(needed)} unbanked lifetime cash`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const hoursArg = argv.indexOf('--hours');
  const horizonHours = hoursArg >= 0 ? Number(argv[hoursArg + 1]) || 6 : 6;
  const asJson = argv.includes('--json');

  if (asJson) {
    const results = PROFILES.map((p) => simulate(p, horizonHours));
    process.stdout.write(
      JSON.stringify(
        {
          horizonHours,
          target: { minSeconds: TUNING_TARGET_MIN_SECONDS, maxSeconds: TUNING_TARGET_MAX_SECONDS },
          profiles: results.map((r) => ({
            id: r.profile.id,
            timeToFirstTierSeconds: r.timeToFirstTierSeconds,
            finalLifetimeCash: r.finalLifetimeCash,
            finalCashPerSec: r.finalCashPerSec,
            upgrades: `${r.upgradesPurchased}/${r.upgradesTotal}`,
          })),
        },
        null,
        2
      ) + '\n'
    );
    return;
  }

  console.log('IDEV : ADMIN — balance simulation');
  console.log(`Target: first permanent Tech Debt tier in 45m–60m (active play)`);
  console.log(`Tier 1 needs ${formatCurrency(FIRST_TIER_UNBANKED)} unbanked lifetime cash`);
  console.log(`Horizon: ${horizonHours}h per profile`);

  for (const profile of PROFILES) {
    printProfile(simulate(profile, horizonHours));
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log('  Long session — prestige ladder (active play)');
  console.log('='.repeat(72));
  const ladder = simulatePrestigeLadder(PROFILES[0], horizonHours);
  if (ladder.rows.length === 0) {
    console.log('  No permanent tiers purchased within the horizon.');
  } else {
    for (const row of ladder.rows) {
      console.log(`  ${formatDuration(row.atSeconds).padEnd(12)}${row.tier}`);
    }
    console.log(`\n  Total permanent upgrades owned: ${ladder.finalPermOwned}`);
  }
  console.log('');
}

main();
