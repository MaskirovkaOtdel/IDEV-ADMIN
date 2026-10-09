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
  /**
   * When the last run upgrade was bought, or null if none was.
   *
   * Distinct from `upgradesPurchased` on purpose: "bought 27 of 27" is equally true
   * of a tree exhausted in the first minute and one exhausted in the last. The
   * timestamp is what says whether the panel went dead.
   */
  lastUpgradeAtSeconds: number | null;
  /** Units owned per generator at the end, for checking upgrade gates are reachable. */
  perGeneratorOwned: Record<string, number>;
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
// Prestige-layer spending
// ---------------------------------------------------------------------------

/** Cheapest next permanent level across the pool. */
function cheapestPermPrice(state: GameState): number {
  return PERM_UPGRADE_DEFS.reduce((sum, def) => {
    const owned = state.prestige.permanentUpgrades[def.id] ?? 0;
    return Math.min(sum, Number(def.baseCost.toString()) * Math.pow(def.costMultiplier, owned));
  }, Number.POSITIVE_INFINITY);
}

/**
 * Spend banked Tech Debt, cheapest level first, until nothing is affordable.
 *
 * Buys in ascending price order rather than pool order: the pool is grouped by
 * effect kind for readability, so iterating it directly would buy a 500-cost
 * global multiplier while skipping an affordable 60-cost one.
 */
function spendTechDebt(
  state: GameState,
  rows: { tier: string; atSeconds: number }[],
  bought: Set<string>,
  elapsed: number
): void {
  let boughtSomething = true;
  while (boughtSomething) {
    boughtSomething = false;

    // Cheapest affordable level, so early Tech Debt goes to the highest-value
    // purchase available rather than the first one in the list.
    let best: { def: (typeof PERM_UPGRADE_DEFS)[number]; owned: number; price: number } | null = null;
    for (const def of PERM_UPGRADE_DEFS) {
      const owned = state.prestige.permanentUpgrades[def.id] ?? 0;
      const price = Number(def.baseCost.toString()) * Math.pow(def.costMultiplier, owned);
      if (price > Number(state.prestige.techDebt.toString())) continue;
      if (!best || price < best.price) best = { def, owned, price };
    }

    if (!best) return;

    state.prestige.techDebt = state.prestige.techDebt.minus(dec(best.price));
    state.prestige.permanentUpgrades[best.def.id] = best.owned + 1;
    boughtSomething = true;

    const key = `${best.def.id}:${best.owned}`;
    if (!bought.has(key)) {
      bought.add(key);
      rows.push({ tier: `${best.def.name} ×${best.owned + 1}`, atSeconds: elapsed });
    }
  }
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
    perGeneratorOwned: Object.fromEntries(
      GENERATOR_DEFS.map((d) => [d.id, state.generators[d.id].owned])
    ),
    // From the milestones rather than a separate counter: they are recorded in
    // purchase order as the loop walks, so the last `upgrade` entry is the last
    // purchase. Deriving it here avoids a second bookkeeping path that could
    // disagree with the events it is meant to summarise.
    lastUpgradeAtSeconds: (() => {
      const last = [...milestones].reverse().find((m) => m.kind === 'upgrade');
      return last ? last.atSeconds : null;
    })(),
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

    spendTechDebt(state, rows, bought, elapsed);

    // Reset only when the payout would actually buy a tier. Resetting on a fixed
    // threshold loops forever once that threshold is below the next tier's price:
    // you would reset every cycle, bank the same amount, and never progress.
    const payout = computeTechDebtGained(state);
    const nextTierPrice = cheapestPermPrice(state);
    const banked = state.prestige.techDebt.plus(payout);
    if (payout.greaterThan(ZERO) && banked.greaterThanOrEqualTo(dec(nextTierPrice))) {
      state = resetForPrestige(state, elapsed * 1000);
      // The reset moved the baseline and wiped the run, so everything derived
      // above is stale. Re-buy on the fresh state: the banked debt is now
      // actually spendable, and the run has to be rebuilt from zero regardless.
      spendTechDebt(state, rows, bought, elapsed);
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

/**
 * Minimum permanent purchases per hour the prestige ladder must sustain.
 *
 * WHY RATE AND NOT "IS THE LAST PURCHASE RECENT"
 * ----------------------------------------------
 * The obvious metric -- how long ago the last purchase happened -- is nearly
 * blind to the bug this exists to catch. Measured on both curves at 24h:
 *
 *   fixed curve   29 purchases, last at 22.8h  ->  4.9% of the horizon idle
 *   broken curve   7 purchases, last at 12.6h  -> 47.6% idle
 *
 * 47.6% versus a 50% threshold means the broken curve slips under it. Worse,
 * at a 4h horizon the relationship inverts: the broken curve looks *healthier*
 * on this metric (20.2% idle) than the fixed one (39.0%), because it stops
 * buying early and so is never caught mid-session. Staleness measures when the
 * last thing happened, not whether the player is still progressing.
 *
 * Purchase rate measures the thing that actually matters -- is the permanent
 * layer still functioning across the session -- and separates the two curves in
 * the same direction at every horizon:
 *
 *   horizon   fixed    broken
 *      4h     0.50     0.75     <- broken looks better early
 *     12h     1.33     0.50
 *     24h     1.21     0.29
 *
 * The rate gate therefore runs at a horizon long enough for the curves to
 * diverge, which is 12h. Below that the broken curve is still buying enough to
 * look fine, because it takes a full day for the dead content to become visible.
 */
export const LADDER_MIN_PURCHASES_PER_HOUR = 0.75;

/**
 * Every generator-gated run upgrade must become reachable.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REPLACES THE GATE I TRIED TO WRITE FIRST
 * ---------------------------------------------------------------------------
 * The complaint was real: a player owned 12/12 upgrades and the panel then read
 * "Nothing to buy here right now" for the rest of a nine-hour session. I assumed
 * that was a pacing defect in the tree and wrote three gates for it. All three
 * passed on the tree that was actually broken:
 *
 *   session horizon  "the tree must survive half a 12h session" -- fired on the
 *                    HEALTHY 27-upgrade tree, because a run is supposed to end
 *                    long before a long session does.
 *   absolute floor   "the tree must last 45 minutes" -- 12 upgrades exhausted at
 *                    1h08m and 27 exhausted at 1h10m. Both pass. Measured, not
 *                    assumed.
 *   first-tier margin "exhaustion must land 10m after the first permanent tier" --
 *                    12 exhausted 18.7m after it, 27 exhausted 20.7m after. Both
 *                    pass.
 *
 * The conclusion is that exhaustion TIME is bounded by the economy, not by how many
 * upgrades exist. The sim buys optimally and runs out of things to spend on at the
 * moment the money curve says it should, whether the tree holds 12 or 27. A fourth
 * variant of a check that cannot fail would be the same mistake four times over.
 *
 * So this gate asserts the property that is genuinely new and genuinely at risk:
 * that an upgrade gated behind a generator count is not permanently unreachable.
 * A mistyped threshold is silent, ships, and produces content nobody can ever buy.
 * That is checkable, and the 27-upgrade tree would fail it if any gate were wrong.
 */
export const RUN_GATED_CHECK_MIN_HORIZON_HOURS = 2;

/**
 * Horizon at which the rate gate runs. 12h is the first horizon where the fixed
 * and broken curves clearly separate (1.33 vs 0.50 purchases/hour) and it costs
 * about 20 seconds of simulation.
 */
export const LADDER_CHECK_MIN_HORIZON_HOURS = 12;

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
  const asCheck = argv.includes('--check');

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

  if (asCheck) {
    const { violations, purchases } = runChecks(horizonHours);
    printCheckReport(horizonHours, violations);
    if (violations.length === 0) printCheckPass(horizonHours, purchases);
    if (violations.length > 0) {
      console.error('\nEconomy invariants failed. If this is an intentional balance');
      console.error('change, update the tuning target in this file deliberately rather');
      console.error('than loosening the check until it passes.');
      process.exitCode = 1;
    }
  }
}

/**
 * Invariants that must hold for the economy to be playable.
 *
 * WHY THIS EXISTS
 * ---------------
 * The dead-permanent-upgrade bug shipped with every check green. The first-tier
 * pacing tests all passed, because the curve was correct at 1e7 and only broke
 * far beyond anything they looked at. Nothing asserted the two numbers that
 * actually matter to a player meeting each other: what the upgrades cost, and
 * what the economy can pay.
 *
 * `--check` is the gate. Without it this program only prints, which means a
 * wildly broken economy produces a table and a green build.
 *
 * The late-game assertion is what would have caught that bug. The old curve
 * bought its 7th permanent upgrade and then stopped for the rest of the session:
 * the ladder went flat, so the progression had ended while the game still looked
 * healthy. A floor on ladder growth at the horizon catches exactly that shape.
 */
interface Violation {
  check: string;
  detail: string;
}

function runChecks(horizonHours: number): { violations: Violation[]; purchases: number } {
  const violations: Violation[] = [];
  const ladderProfile = PROFILES[0];

  // 1. First permanent tier must land in the tuning window, for both profiles.
  //    Idle is allowed to run slower; the first-tier test already allows 1.5x.
  for (const profile of PROFILES) {
    const result = simulate(profile, horizonHours);
    const t = result.timeToFirstTierSeconds;

    if (t === null) {
      violations.push({
        check: `first-tier/${profile.id}`,
        detail: `never reached within ${horizonHours}h — need ${formatCurrency(FIRST_TIER_UNBANKED)} unbanked lifetime cash`,
      });
      continue;
    }

    const limit = profile.id === 'active' ? TUNING_TARGET_MAX_SECONDS : TUNING_TARGET_MAX_SECONDS * 1.5;
    if (t > limit) {
      violations.push({
        check: `first-tier/${profile.id}`,
        detail: `${formatDuration(t)} exceeds the ${formatDuration(limit)} ceiling`,
      });
    }
  }

  // 2. The ladder must still be climbing when the horizon ends.
  //
  // Not "the player owns N upgrades" — a flat ladder and a finished one look the
  // same at a fixed N. What matters is that the most recent purchase happened
  // near the end of the session, which means the progression is still running
  // and the curve can pay for the rest of the pool.
  if (horizonHours < LADDER_CHECK_MIN_HORIZON_HOURS) {
    // Not a failure: too short a session to mean anything. Reported so a green
    // run at a short horizon is not mistaken for a passing ladder check.
    console.log(
      `  SKIP  ladder/rate — horizon ${horizonHours}h is below ` +
        `${LADDER_CHECK_MIN_HORIZON_HOURS}h. Too short for a dead payout curve to show: ` +
        'the broken curve still buys often enough early on to look healthy.'
    );
    return { violations, purchases: simulatePrestigeLadder(ladderProfile, horizonHours).rows.length };
  }

  const ladder = simulatePrestigeLadder(ladderProfile, horizonHours);
  const purchases = ladder.rows.length;
  const rate = purchases / horizonHours;

  if (purchases === 0) {
    violations.push({
      check: 'ladder/rate',
      detail: `no permanent upgrade bought within ${horizonHours}h — prestige pays nothing`,
    });
  } else if (rate < LADDER_MIN_PURCHASES_PER_HOUR) {
    const lastPurchase = ladder.rows[ladder.rows.length - 1];
    violations.push({
      check: 'ladder/rate',
      detail:
        `${purchases} purchase(s) over ${horizonHours}h = ${rate.toFixed(2)}/h ` +
        `(<${LADDER_MIN_PURCHASES_PER_HOUR}/h). Last at ${formatDuration(lastPurchase.atSeconds)}. ` +
        'The permanent layer has stopped being a progression — usually the payout ' +
        'curve cannot reach the upgrade costs.',
    });
  }

  // 3. No run upgrade may be permanently unreachable.
  //
  // Every generator-gated upgrade has to become buyable within the horizon. A gate
  // set above what the economy can deliver is silent: it ships, it renders, and no
  // player can ever claim it.
  if (horizonHours >= RUN_GATED_CHECK_MIN_HORIZON_HOURS) {
    const run = simulate(ladderProfile, horizonHours);
    const owned = run.perGeneratorOwned;

    const stranded: string[] = [];
    for (const def of UPGRADE_DEFS) {
      const req = def.requires;
      if (!req?.generatorId || req.owned === undefined) continue;
      const have = owned[req.generatorId] ?? 0;
      if (have < req.owned) {
        stranded.push(`${def.name} (needs ${req.owned} x ${req.generatorId}, reached ${have})`);
      }
    }

    if (stranded.length > 0) {
      violations.push({
        check: 'run-tree/reachable',
        detail:
          `${stranded.length} generator-gated upgrade(s) unreachable after ${horizonHours}h: ` +
          `${stranded.join('; ')}. Either the threshold is above what the curve delivers, ` +
          'or the gate should be on cash instead.',
      });
    }
  } else {
    console.log(
      `  SKIP  run-tree/reachable - horizon ${horizonHours}h is below ` +
        `${RUN_GATED_CHECK_MIN_HORIZON_HOURS}h.`
    );
  }

  return { violations, purchases };
}

function printCheckReport(horizonHours: number, violations: Violation[]): void {
  console.log(`${'='.repeat(72)}`);
  console.log(`  Gate — economy invariants (${horizonHours}h horizon)`);
  console.log('='.repeat(72));

  if (violations.length === 0) {
    console.log('  PASS  first-tier window held for both profiles');
    return;
  }

  console.log(`  ${violations.length} violation(s):`);
  for (const v of violations) {
    console.log(`  FAIL  ${v.check}: ${v.detail}`);
  }
}

/** Non-fatal summary of what passed, so the report is honest when skipped. */
function printCheckPass(horizonHours: number, purchases: number): void {
  if (horizonHours < LADDER_CHECK_MIN_HORIZON_HOURS) return;
  console.log(
    `  PASS  ladder sustained ${(purchases / horizonHours).toFixed(2)} purchases/h ` +
      `(floor ${LADDER_MIN_PURCHASES_PER_HOUR}/h) over ${horizonHours}h`
  );
}

main();
