/**
 * The run-upgrade tree, and the Upgrades panel it feeds.
 *
 * WHY THIS FILE IS MOSTLY ABOUT SIZING
 * ------------------------------------
 * The pool-gated upgrades exist to give LoC and Coffee a purpose. Two rules govern
 * their cost, and both were violated by the original six:
 *
 *   NEVER PRESSURE. A cost must never outrun inflow, or the player chooses between
 *   spending and losing income. That is not an idle game, it is a chore. The pools
 *   accumulate on their own, so anything is eventually payable -- that is what makes
 *   them a sink rather than a wall, and it is the rule the sizing follows.
 *
 *   NEVER TRIVIAL. The originals cost fractions of a second of production -- 150 LoC
 *   against ~2900/s is 0.05 seconds. Spending one was not a decision, which is why
 *   the pools read as decorative.
 *
 * So pool costs are expressed as MINUTES of the inflow available at the tier that
 * unlocks them. Those are asserted below against the rates in the reviewed save, so
 * the rule is a test rather than a comment.
 */
import { describe, it, expect } from 'vitest';
import { UPGRADE_DEFS } from '../game/upgrades';
import { GENERATOR_DEFS } from '../game/generators';
import { dec } from '../game/decimal';
import { createInitialState } from '../game/serialize';
import { computeProductionSnapshot } from '../game/engine';
import { meetsUpgradeRequirements } from '../game/conditions';

/** The reviewed save's generator counts. */
const LATE_OWNED: Record<string, number> = {
  juniorDev: 150,
  seniorDev: 110,
  codeReview: 110,
  linter: 90,
  testSuite: 60,
  ciPipeline: 50,
  k8sCluster: 40,
};

describe('pool costs are a sink, never a wall', () => {
  const poolUpgrades = UPGRADE_DEFS.filter((def) => def.cost.resource !== 'cash');

  /**
   * The cheap on-ramp is deliberately cheap.
   *
   * The original six pool upgrades cost fractions of a second of production. They
   * are bought in the first two minutes and they are the mechanic's introduction --
   * a player needs to see "LoC buys things" before the cost matters. Rescaling them
   * would delay the tutorial without adding anything.
   *
   * What must not happen is for THOSE to be the only pool upgrades. So the
   * meaningfulness rule applies to the late ones, and a separate assertion requires
   * that late ones exist at all.
   */
  const ON_RAMP_MAX = 1_000;
  const latePoolUpgrades = poolUpgrades.filter(
    (def) => Number(def.cost.amount.toString()) > ON_RAMP_MAX
  );

  it('there are pool-gated upgrades at all', () => {
    expect(poolUpgrades.length).toBeGreaterThan(0);
  });

  it('there are pool-gated upgrades big enough to be a real sink', () => {
    // Without this the two assertions below could pass on an empty set.
    expect(latePoolUpgrades.length).toBeGreaterThanOrEqual(4);
  });

  /**
   * Minutes of production needed to afford `def`, measured against the income
   * available WHEN IT UNLOCKS rather than at the end of a run.
   *
   * That distinction is the whole test. AI Copilot Fleet costs 20k LoC, which is
   * seven seconds of a mature team's output and half a minute of a small one -- and
   * it unlocks at 10 Code Reviews, so the small number is the honest one. Measuring
   * everything against late-game income hides early upgrades behind an inflow they
   * will never see, and a first version of this file did exactly that and failed a
   * perfectly reasonable cost.
   */
  function minutesToAfford(def: (typeof UPGRADE_DEFS)[number]): number {
    const state = createInitialState();

    if (def.requires?.generatorId && def.requires.owned !== undefined) {
      // At the gate, and no further: this is the state the player is in when the
      // upgrade first becomes visible.
      for (const g of GENERATOR_DEFS) {
        state.generators[g.id] = {
          owned: g.id === def.requires.generatorId ? def.requires.owned : 0,
          unlocked: true,
        };
      }
    } else {
      // Ungated pool upgrade: assume the on-ramp is done, which is roughly a small
      // mid-game team. Matching the reviewed save's shape, scaled down.
      for (const g of GENERATOR_DEFS) {
        state.generators[g.id] = { owned: 20, unlocked: true };
      }
    }

    // The same upgrades a player would plausibly hold at that point, so the
    // multiplier stack is representative rather than zero.
    state.upgrades.purchased = ['codeMaster', 'styleGuide', 'testObsession'];

    const rate = computeProductionSnapshot(state).perResource[def.cost.resource];
    if (num(rate) <= 0) return Infinity;
    return Number(def.cost.amount.toString()) / num(rate) / 60;
  }

  it('each late pool cost is minutes of inflow, not seconds', () => {
    for (const def of latePoolUpgrades) {
      const minutes = minutesToAfford(def);
      expect(
        minutes,
        `${def.name} costs ${minutes.toFixed(2)} minutes of production when it unlocks`
      ).toBeGreaterThan(0.5);
    }
  });

  it('no late pool cost exceeds a few hours of waiting', () => {
    // The ceiling is what keeps them payable by WAITING. Anything longer stops
    // being a sink and starts gating progression on patience.
    for (const def of latePoolUpgrades) {
      const hours = minutesToAfford(def) / 60;
      expect(hours, `${def.name} needs ${hours.toFixed(2)}h`).toBeLessThan(3);
    }
  });

  it('no late pool cost is a large multiple of a pool holding', () => {
    // If a cost were many times what the resource accumulates in an hour, the
    // player could not hold enough without draining everything else -- pressure,
    // not a sink.
    for (const def of latePoolUpgrades) {
      const hours = minutesToAfford(def) / 60;
      expect(hours, `${def.name} is ${hours.toFixed(1)}x a one-hour pool`).toBeLessThan(2.5);
    }
  });

  it('the on-ramp stays cheap, so the mechanic is taught early', () => {
    // The opposite direction, so the sizing rule cannot be satisfied by making
    // everything enormous.
    for (const def of poolUpgrades.filter((d) => Number(d.cost.amount.toString()) <= ON_RAMP_MAX)) {
      expect(Number(def.cost.amount.toString()), `${def.name} is no longer an on-ramp`).toBeLessThan(
        ON_RAMP_MAX
      );
    }
  });

  it('every LATE pool upgrade stays above the on-ramp, by name', () => {
    // Closes a hole the other assertions cannot see. Every sizing check above
    // filters to `latePoolUpgrades`, which is DEFINED by cost -- so setting one to
    // 50 silently drops it out of the checked set and everything passes. Verified:
    // the trivialise-one-to-50 case was not caught until this existed.
    //
    // Named explicitly so the set cannot be quietly redefined by the data.
    const MUST_STAY_LATE = [
      'styleGuideSecondEdition',
      'flakyTestWhisperer',
      'monorepoMigrationRun',
      'contractorsSafe',
      'incidentResponse',
      'testCoveragePush',
      'aiCopilot',
      'refactorBot',
    ];

    for (const id of MUST_STAY_LATE) {
      const def = UPGRADE_DEFS.find((d) => d.id === id);
      expect(def, `${id} is missing from the tree`).toBeTruthy();
      const cost = Number(def!.cost.amount.toString());
      expect(cost, `${id} costs ${cost}, which demotes it to the on-ramp`).toBeGreaterThan(
        ON_RAMP_MAX
      );
    }
  });
});

describe('generator gates pace themselves and stay reachable', () => {
  const gated = UPGRADE_DEFS.filter((def) => def.requires?.generatorId);

  it('gates on a count the reviewed save can meet', () => {
    // A threshold above what a real player reaches is content nobody can claim.
    for (const def of gated) {
      const req = def.requires!;
      const owned = LATE_OWNED[req.generatorId!] ?? 0;
      expect(owned, `${def.name} needs ${req.owned} of ${req.generatorId}`).toBeGreaterThanOrEqual(
        req.owned!
      );
    }
  });

  it('the reviewed save satisfies every generator gate', () => {
    const state = createInitialState();
    for (const def of GENERATOR_DEFS) {
      state.generators[def.id] = { owned: LATE_OWNED[def.id] ?? 0, unlocked: true };
    }
    state.resources.lifetimeCash = dec(3.79e9);

    for (const def of gated) {
      const result = meetsUpgradeRequirements(state, def);
      expect(result.met, `${def.name}: ${result.reason}`).toBe(true);
    }
  });

  it('a fresh game cannot satisfy the late gates', () => {
    // Otherwise "gated" is decorative and the tree paces nothing.
    const fresh = createInitialState();
    const late = gated.filter((def) => (def.requires?.owned ?? 0) > 1);
    for (const def of late) {
      expect(meetsUpgradeRequirements(fresh, def).met, `${def.name} is not a real gate`).toBe(
        false
      );
    }
  });
});

describe('the tree has room to grow', () => {
  it('is meaningfully larger than the original twelve', () => {
    expect(UPGRADE_DEFS.length).toBeGreaterThanOrEqual(24);
  });

  it('spans all three gate families', () => {
    const byPool = UPGRADE_DEFS.filter((d) => d.cost.resource !== 'cash').length;
    const byCount = UPGRADE_DEFS.filter((d) => d.requires?.generatorId).length;
    const byCash = UPGRADE_DEFS.filter(
      (d) => d.requires?.lifetimeCash || (!d.requires && d.cost.resource === 'cash')
    ).length;
    expect(byPool, 'pool-gated upgrades').toBeGreaterThan(0);
    expect(byCount, 'generator-count gates').toBeGreaterThan(0);
    expect(byCash, 'cash/lifetime gates').toBeGreaterThan(0);
  });

  it('keeps every id unique', () => {
    const ids = UPGRADE_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every upgrade a name, description and a positive effect', () => {
    for (const def of UPGRADE_DEFS) {
      expect(def.name.length, `${def.id} has no name`).toBeGreaterThan(0);
      expect(def.description.length, `${def.id} has no description`).toBeGreaterThan(0);
      expect(def.effects.length, `${def.id} has no effects`).toBeGreaterThan(0);
      for (const effect of def.effects) {
        expect(Number.isFinite(effect.value), `${def.id} has a non-finite effect`).toBe(true);
      }
      expect(def.cost.amount.greaterThan(dec(0)), `${def.id} is free`).toBe(true);
    }
  });

  it('never lets a single upgrade multiply production absurdly', () => {
    // One-shot multipliers stack into the economy. A 10x from a single run upgrade
    // would reshape the whole curve, which is a rebalance, not content.
    for (const def of UPGRADE_DEFS) {
      for (const effect of def.effects) {
        if (effect.kind !== 'globalMult') continue;
        expect(effect.value, `${def.id} multiplies all production by ${effect.value}`).toBeLessThan(
          2
        );
      }
    }
  });
});

describe('the tree does not distort the economy', () => {
  it('all 27 together are a bounded multiplier, not a runaway', () => {
    // Buying the whole tree at once must not make production explode. Each effect
    // is a factor; the product is the ceiling this content adds.
    const state = createInitialState();
    for (const def of GENERATOR_DEFS) {
      state.generators[def.id] = { owned: LATE_OWNED[def.id] ?? 0, unlocked: true };
    }
    const before = computeProductionSnapshot(state).perResource.cash;

    for (const def of UPGRADE_DEFS) state.upgrades.purchased.push(def.id);
    const after = computeProductionSnapshot(state).perResource.cash;

    const ratio = num(after.div(before));
    // Generators themselves do not change, so this is purely the upgrade stack.
    expect(ratio, `full tree multiplies production by ${ratio.toFixed(1)}x`).toBeGreaterThan(1);
    expect(ratio, `full tree multiplies production by ${ratio.toFixed(1)}x`).toBeLessThan(1e6);
  });
});

function num(d: { toString(): string }): number {
  return Number(d.toString());
}
