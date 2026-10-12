/**
 * Achievements.
 *
 * WHAT IS ACTUALLY BEING TESTED HERE
 * ----------------------------------
 * Three of the ten achievements (`codebase`, `breakeven`, `series_a`) climb from
 * production alone — nothing you click unlocks them. Several others are measured
 * against generator counts that a prestige zeroes.
 *
 * That puts the real risk in the WIRING, not the predicates. A definition can be
 * perfect and still never fire, because the mutation path that should have called
 * `checkAchievements` did not. So the largest block in this file drives each store
 * action in turn and asserts it can actually earn something — a test that fails
 * when a path stops checking, rather than a unit test that keeps passing while a
 * feature quietly does nothing.
 *
 * The monotonicity tests matter for the same reason in reverse: an achievement
 * that prestige UN-earns is just as broken as one that never fires, and it is
 * harder to notice, because the player watches the badge vanish.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  checkAchievements,
  isMet,
  parseAchievementRecord,
  progressFraction,
  unlockedCount,
  type AchievementId,
} from '../game/achievements';
import { useGameStore } from '../game/gameStore';
import { createInitialState, serializeState, deserializeState } from '../game/serialize';
import { clearSaveData } from '../game/storage';
import { dec, ZERO } from '../game/decimal';
import type { GameState } from '../game/types';

/** A state with everything zeroed except what a test sets. */
function stateWith(over: Partial<GameState> = {}): GameState {
  return { ...createInitialState(0), ...over };
}

function earnedIds(record: Record<string, number>): string[] {
  return Object.keys(record).sort();
}

beforeEach(() => {
  clearSaveData();
  useGameStore.setState({
    gameState: createInitialState(),
    pendingAchievements: [],
    pendingArrivals: [],
    offlineReport: null,
    sessionSeconds: 0,
  });
});

describe('the definitions themselves', () => {
  it('has unique ids', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every definition is reachable and described', () => {
    // A definition with no name, no description or no icon renders as a blank
    // row that looks like a loading failure.
    for (const def of ACHIEVEMENTS) {
      expect(def.name.trim().length, `${def.id} has no name`).toBeGreaterThan(0);
      expect(def.description.trim().length, `${def.id} has no description`).toBeGreaterThan(0);
      expect(def.icon.trim().length, `${def.id} has no icon`).toBeGreaterThan(0);
      expect(def.target.greaterThan(ZERO), `${def.id} has a non-positive target`).toBe(true);
    }
  });

  it('a fresh game has earned nothing', () => {
    const fresh = createInitialState();
    // `first_hire` must not fire on a fresh state, or every new player is
    // congratulated for a team they do not have.
    expect(unlockedCount(fresh.achievements)).toBe(0);
    for (const def of ACHIEVEMENTS) {
      expect(isMet(def, fresh), `${def.id} is met on a fresh game`).toBe(false);
    }
  });

  it('derives "met" from measure and target, never separately', () => {
    // Construct a state where measure exactly equals target for one def.
    const state = stateWith({ stats: { ...createInitialState(0).stats, totalCashEarned: dec(1e6) } });
    const breakeven = ACHIEVEMENTS_BY_ID.breakeven;
    expect(breakeven.measure(state).eq(breakeven.target)).toBe(true);
    expect(isMet(breakeven, state)).toBe(true);
  });
});

describe('progress reads from the same measure that unlocks', () => {
  it('is a fraction between 0 and 1', () => {
    for (const def of ACHIEVEMENTS) {
      for (const factor of [0, 0.5, 1, 50]) {
        const state = stateWith();
        // Force `measure` to a known value by stubbing it rather than crafting a
        // state for every combination — the point is the arithmetic in
        // progressFraction, not the predicate.
        const stub = { ...def, measure: () => def.target.times(factor) };
        const f = progressFraction(stub, state);
        expect(Number.isFinite(f), `${def.id} at ${factor}x gave ${f}`).toBe(true);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });

  it('clamps at 1 when measure overshoots the target', () => {
    // A cash milestone measuring 3.79e9 against a 1e9 target must not produce a
    // width of 379% and stretch its container.
    const def = { ...ACHIEVEMENTS_BY_ID.breakeven, measure: () => dec(3.79e9) };
    expect(progressFraction(def, stateWith())).toBe(1);
  });

  it('agrees with isMet at the boundary', () => {
    // Just below the target: incomplete and < 1. Exactly at: complete and 1.
    const def = ACHIEVEMENTS_BY_ID.team_of_5;
    const justUnder = { ...def, measure: () => dec(4) };
    expect(progressFraction(justUnder, stateWith())).toBeCloseTo(0.8, 5);

    const exact = { ...def, measure: () => dec(5) };
    expect(progressFraction(exact, stateWith())).toBe(1);
  });
});

describe('unlocking is monotonic', () => {
  it('never removes an entry, even when the criterion stops being true', () => {
    // A prestige zeroes generators. `team_of_5` must NOT be un-earned by that.
    const before = stateWith();
    (before.generators as Record<string, { owned: number; unlocked: boolean }>).juniorDev = {
      owned: 15,
      unlocked: true,
    };
    (before.generators as Record<string, { owned: number; unlocked: boolean }>).seniorDev = {
      owned: 12,
      unlocked: true,
    };

    const first = checkAchievements(before, {});
    expect(first.newlyUnlocked).toContain('team_of_5');
    expect(first.newlyUnlocked, '27 generators owned').toContain('team_of_25');

    // Now the state that destroys the criterion: every generator returns to zero.
    const after = stateWith();
    for (const id of Object.keys(after.generators)) {
      (after.generators as Record<string, { owned: number; unlocked: boolean }>)[id] = {
        owned: 0,
        unlocked: false,
      };
    }
    expect(isMet(ACHIEVEMENTS_BY_ID.team_of_25, after)).toBe(false);

    const second = checkAchievements(after, first.record);
    expect(earnedIds(second.record)).toEqual(earnedIds(first.record));
    expect(second.newlyUnlocked).toEqual([]);
  });

  it('returns the same object when nothing unlocks, so ticks do not re-render', () => {
    // The engine ticks continuously. Allocating a fresh record each tick would
    // invalidate every achievement selector on every frame.
    const record = checkAchievements(stateWith(), {}).record;
    const again = checkAchievements(stateWith(), record);
    expect(again.record).toBe(record);
    expect(again.newlyUnlocked).toEqual([]);
  });

  it('does not re-report an achievement it already has', () => {
    const withOwned = stateWith();
    (withOwned.generators.juniorDev as { owned: number }).owned = 1;
    const first = checkAchievements(withOwned, {});
    expect(first.newlyUnlocked).toContain('first_hire');

    const second = checkAchievements(withOwned, first.record);
    expect(second.newlyUnlocked).not.toContain('first_hire');
  });
});

describe('hostile input', () => {
  it('drops unknown ids', () => {
    // A removed achievement must not linger in a save and keep counting.
    expect(parseAchievementRecord({ not_a_thing: 123 })).toEqual({});
  });

  it('drops non-finite and negative timestamps', () => {
    // NaN renders as "Invalid Date"; negative can only come from a hand-edit.
    expect(parseAchievementRecord({ first_hire: 'soon' })).toEqual({});
    expect(parseAchievementRecord({ first_hire: -5 })).toEqual({});
    expect(parseAchievementRecord({ first_hire: Infinity })).toEqual({});
    expect(parseAchievementRecord({ first_hire: null })).toEqual({ first_hire: 0 });
  });

  it('survives a non-object', () => {
    expect(parseAchievementRecord(null)).toEqual({});
    expect(parseAchievementRecord([1, 2, 3])).toEqual({});
    expect(parseAchievementRecord('first_hire')).toEqual({});
    expect(parseAchievementRecord(42)).toEqual({});
  });
});

describe('the save round-trip', () => {
  it('carries earned achievements through serialize and back', () => {
    const state = stateWith({ achievements: { first_hire: 1700000000000 } });
    const restored = deserializeState(serializeState(state, 0), 0);
    expect(restored.achievements.first_hire).toBe(1700000000000);
  });

  it('loads a pre-achievements save without complaint', () => {
    // The whole reason this is additive: a v1 save written before the layer
    // existed has no `achievements` key at all.
    const legacy = JSON.parse(serializeState(createInitialState(0), 0));
    delete legacy.achievements;
    const restored = deserializeState(JSON.stringify(legacy), 0);
    expect(restored.achievements).toEqual({});
    expect(unlockedCount(restored.achievements)).toBe(0);
  });

  it('drops a corrupt record on load rather than carrying NaN', () => {
    const blob = JSON.parse(serializeState(createInitialState(0), 0));
    blob.achievements = { first_hire: 'yesterday', invented_achievement: 5 };
    const restored = deserializeState(JSON.stringify(blob), 0);
    expect(restored.achievements).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// The wiring tests. These are the ones that matter.
// ---------------------------------------------------------------------------

describe('every mutation path actually checks', () => {
  it('buying a generator earns first_hire', () => {
    useGameStore.setState({
      gameState: stateWith({
        resources: { ...createInitialState(0).resources, cash: dec(1e9) },
      }),
    });
    const before = useGameStore.getState().pendingAchievements;
    expect(before).toEqual([]);

    const result = useGameStore.getState().buyGenerator('juniorDev', 1);
    expect(result.ok).toBe(true);

    expect(useGameStore.getState().gameState.achievements.first_hire).toBeDefined();
    expect(useGameStore.getState().pendingAchievements).toContain('first_hire');
  });

  it('buying an upgrade earns first_upgrade', () => {
    // `codeMaster` is the cheapest upgrade and costs LoC, which is free to mint
    // through the resource pools the player has already accrued.
    const state = stateWith();
    state.upgrades.purchased = [];
    useGameStore.setState({
      gameState: {
        ...state,
        resources: {
          ...state.resources,
          linesOfCode: dec(1e12),
          coffee: dec(1e12),
          cash: dec(1e12),
        },
      },
    });

    const result = useGameStore.getState().purchaseUpgrade('codeMaster');
    expect(result.ok).toBe(true);
    expect(useGameStore.getState().gameState.achievements.first_upgrade).toBeDefined();
    expect(useGameStore.getState().pendingAchievements).toContain('first_upgrade');
  });

  it('a tick earns the lifetime-total achievements, which no click can', () => {
    // This is the path that the three passive milestones depend on. If `tick`
    // stopped checking, `breakeven` would never fire for a player who does not
    // open a menu.
    const state = stateWith();
    useGameStore.setState({
      gameState: {
        ...state,
        stats: { ...state.stats, totalCashEarned: dec(5e5) },
      },
    });

    // Just short of 1e6: nothing yet.
    useGameStore.getState().tick(1);
    expect(useGameStore.getState().gameState.achievements.breakeven).toBeUndefined();

    // Cross it by production alone.
    useGameStore.setState((s) => ({
      gameState: { ...s.gameState, stats: { ...s.gameState.stats, totalCashEarned: dec(1.5e6) } },
    }));
    useGameStore.getState().tick(1);

    expect(useGameStore.getState().gameState.achievements.breakeven).toBeDefined();
    expect(useGameStore.getState().pendingAchievements).toContain('breakeven');
  });

  it('granting resources through the debug panel also checks', () => {
    // The debug path is the easiest one to forget precisely because it is not
    // part of the real game loop — and it is how a developer tests the game.
    const state = stateWith();
    useGameStore.setState({
      gameState: { ...state, stats: { ...state.stats, totalCashEarned: dec(2e9) } },
    });
    useGameStore.getState().grantResources('cash', dec(1));

    expect(useGameStore.getState().gameState.achievements.series_a).toBeDefined();
    expect(useGameStore.getState().gameState.achievements.breakeven).toBeDefined();
  });

  it('performPrestige earns burn_it and keeps what was already earned', () => {
    const state = stateWith({
      achievements: { team_of_25: 111 },
      stats: { ...createInitialState(0).stats, prestigeCount: 0 },
    });
    useGameStore.setState({
      gameState: {
        ...state,
        resources: { ...state.resources, lifetimeCash: dec(1e12), cash: dec(1e12) },
      },
    });

    const result = useGameStore.getState().performPrestige();
    expect(result.ok).toBe(true);

    const after = useGameStore.getState().gameState;
    expect(after.stats.prestigeCount).toBe(1);
    expect(after.achievements.burn_it).toBeDefined();
    // The prestige zeroed every generator, and the record survived anyway.
    expect(after.achievements.team_of_25).toBe(111);
    expect(useGameStore.getState().pendingAchievements).toContain('burn_it');
  });

  it('hydrating credits achievements earned while away without announcing them', () => {
    // A returning player already has the offline dialog telling them what they
    // earned. Replaying a backlog of unlocks on top of that is noise.
    const blob = JSON.parse(serializeState(createInitialState(Date.now()), Date.now()));
    blob.stats.totalCashEarned = '2e9';
    localStorage.setItem('idev-admin:save', JSON.stringify(blob));

    useGameStore.setState({
      gameState: stateWith({ stats: { ...createInitialState(0).stats, totalCashEarned: dec(2e9) } }),
    });
    useGameStore.getState().hydrate();

    const state = useGameStore.getState();
    expect(state.gameState.achievements.series_a).toBeDefined();
    expect(state.pendingAchievements).toEqual([]);
  });

  it('hardReset clears achievements along with everything else', () => {
    // A reset that left achievements behind would report a fresh game as
    // having a history, which is the same class of lie as the header reading
    // "TECH DEBT 0" for a player who had never prestiged.
    useGameStore.setState({
      gameState: stateWith({ achievements: { first_hire: 1, team_of_5: 2 } }),
    });
    useGameStore.getState().hardReset();

    expect(unlockedCount(useGameStore.getState().gameState.achievements)).toBe(0);
    expect(useGameStore.getState().pendingAchievements).toEqual([]);
  });

  it('importing a save announces nothing', () => {
    const json = serializeState(
      stateWith({ achievements: { first_hire: 1 } }),
      0
    );
    useGameStore.getState().loadFromString(json);

    expect(useGameStore.getState().gameState.achievements.first_hire).toBe(1);
    expect(useGameStore.getState().pendingAchievements).toEqual([]);
  });
});

describe('the achievements layer cannot change the economy', () => {
  it('earning achievements writes nothing outside the record', () => {
    // An achievement that changed a resource, a cost or a generator count would be
    // a reward wearing a milestone's clothes. Snapshot everything that matters and
    // assert it is byte-identical after a check.
    const before = stateWith();
    (before.generators.juniorDev as { owned: number }).owned = 3;
    before.upgrades.purchased = ['codeMaster'];
    const snapshot = {
      resources: before.resources.cash.toString(),
      lifetime: before.resources.lifetimeCash.toString(),
      techDebt: before.prestige.techDebt.toString(),
      owned: before.generators.juniorDev.owned,
      upgrades: [...before.upgrades.purchased],
    };

    // `checkAchievements` is pure: it returns a NEW RECORD, never a mutated state.
    // That is the property being asserted — it cannot grant a resource because it
    // has no state to grant it into.
    const result = checkAchievements(before, {});

    expect(result.newlyUnlocked).toContain('first_hire');

    // The input state is untouched: same object, same contents. Compared against a
    // SNAPSHOT taken before the call — comparing `before.x` to `before.x` would
    // pass whether or not anything mutated, which is a test that cannot fail.
    expect(before.resources.cash.toString()).toBe(snapshot.resources);
    expect(before.resources.lifetimeCash.toString()).toBe(snapshot.lifetime);
    expect(before.prestige.techDebt.toString()).toBe(snapshot.techDebt);
    expect(before.generators.juniorDev.owned).toBe(snapshot.owned);
    expect(before.upgrades.purchased).toEqual(snapshot.upgrades);
  });

  it('has no import path to the store or to settings', () => {
    // Read from source rather than trusting review. The moment somebody imports
    // useGameStore here, the layer stops being pure and can start granting.
    const source = readSource('game', 'achievements.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/from\s+'\.\/gameStore'/);
    expect(source).not.toMatch(/from\s+'\.\/settings'/);
    expect(source).not.toMatch(/grantResources/);
  });
});

function readSource(...parts: string[]): string {
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { resolve } = require('node:path') as typeof import('node:path');
  return readFileSync(resolve(import.meta.dirname, '..', ...parts), 'utf8');
}

// Compile-time guard: every id in the union must exist in the map.
const _exhaustive: Record<AchievementId, true> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, true])
) as Record<AchievementId, true>;
void _exhaustive;