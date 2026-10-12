/**
 * Zustand store for IDEV : ADMIN.
 *
 * DESIGN
 *   • `gameState` is the serialized game. Every action produces a NEW top-level
 *     state object with fresh `resources`/`generators` maps, so React selectors
 *     see changed references only when something really changed. The engine still
 *     mutates the object it is handed — that object is always a throwaway clone.
 *   • `transient` holds tick-derived display data (production snapshot, last
 *     tick timestamp, save status) that must not be persisted.
 *   • All legality checks live here and are shared with the UI through the same
 *     helpers, so a card can never offer an action the store refuses.
 */
import { create } from 'zustand';
import type Decimal from 'break_infinity.js';
import type {
  GameState,
  GeneratorId,
  OfflineReport,
  PermUpgradeId,
  ProductionSnapshot,
  ResourceId,
  UpgradeId,
} from './types';
import { checkAchievements, type AchievementId } from './achievements';
import { GENERATOR_IDS } from './types';
import { dec, ZERO } from './decimal';
import { computeProductionSnapshot, engineTick, MAX_DELTA_SECONDS } from './engine';
import { costForBulkPurchase, effectiveCostGrowth, maxAffordable } from './formulas';
import { computeMultipliers } from './multipliers';
import { genDef } from './generators';
import { upgradeDef, UPGRADE_DEFS } from './upgrades';
import { canAffordUpgrade, meetsUpgradeRequirements } from './conditions';
import {
  canPrestige,
  computeTechDebtGained,
  purchasePermUpgrade,
  resetForPrestige,
} from './prestige';
import { permUpgradeCost, PERM_UPGRADE_DEFS } from './permUpgrades';
import { createInitialState, serializeState } from './serialize';
import { deserializeState } from './serialize';
import {
  clearSaveData,
  getLastSavedAt,
  loadGameState,
  saveGameState,
} from './storage';
import { applyOfflineProgress, MIN_OFFLINE_SECONDS_FOR_REPORT } from './offline';

export type BuyAmount = 1 | 10 | 100 | 'max' | number;

export interface TransientState {
  /** ms of the last processed tick */
  lastTickAt: number;
  /** bumped every tick; UI selectors can subscribe to this cheaply */
  tickVersion: number;
  /** per-resource production rates from the most recent tick */
  production: ProductionSnapshot;
  /** multiplies every generator cost right now */
  costDiscount: Decimal;
  /** effective cost growth per generator right now */
  costGrowthDelta: number;
  save: {
    status: 'idle' | 'saving' | 'saved' | 'error';
    lastSavedAt: number | null;
  };
}

export interface PurchaseResult {
  ok: boolean;
  error?: string;
  /** number of units actually bought */
  count?: number;
  /** Tech Debt actually spent (permanent upgrades) */
  spent?: Decimal;
}

const OK: PurchaseResult = { ok: true };

function emptyProduction(): ProductionSnapshot {
  const perGenerator = {} as Record<GeneratorId, Decimal>;
  for (const id of GENERATOR_IDS) perGenerator[id] = ZERO;
  return {
    perResource: { linesOfCode: ZERO, coffee: ZERO, cash: ZERO },
    perGenerator,
    revenuePerSec: ZERO,
    cashPerSec: ZERO,
  };
}

/** Deep-enough clone for the engine to mutate without touching store state. */
function cloneForEngine(state: GameState): GameState {
  return {
    ...state,
    resources: { ...state.resources },
    stats: { ...state.stats },
    generators: { ...state.generators },
    upgrades: { purchased: state.upgrades.purchased },
    prestige: { ...state.prestige, permanentUpgrades: { ...state.prestige.permanentUpgrades } },
  };
}

/**
 * Fold newly-met achievements into a state, returning any that just unlocked.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY MUTATION PATH MUST CALL THIS
 * ---------------------------------------------------------------------------
 * Achievements are passive. Three of the ten (`codebase`, `breakeven`,
 * `series_a`) are measured against lifetime totals that climb from production
 * alone — nothing you click unlocks them. So the check cannot live only on the
 * action paths; it has to run on `tick`.
 *
 * That inverts the usual risk: not "one path forgot to check" but "a path checked
 * and a second one did not", which is invisible from either side. The defence is
 * `achievements.test.ts`, which drives every mutating action in turn and asserts
 * each one can earn something — a wiring test rather than a unit test.
 *
 * Returns the SAME state reference when nothing unlocked, so an unchanged
 * achievement set cannot invalidate selectors on every frame.
 */
function applyAchievements(
  state: GameState,
  now: number
): { state: GameState; newlyUnlocked: AchievementId[] } {
  const { record, newlyUnlocked } = checkAchievements(state, state.achievements, now);
  if (newlyUnlocked.length === 0) return { state, newlyUnlocked };
  return { state: { ...state, achievements: record }, newlyUnlocked };
}

/**
 * Fold achievements into a freshly-built state and hand back both halves.
 *
 * Used by the explicit actions so each one reads as a single step:
 * `const { state: next, pending } = withAchievements(candidate);`
 */
function withAchievements(candidate: GameState): {
  state: GameState;
  pending: AchievementId[];
} {
  const { state, newlyUnlocked } = applyAchievements(candidate, Date.now());
  return { state, pending: newlyUnlocked };
}

export interface GameStoreState {
  gameState: GameState;
  transient: TransientState;
  /** Offline report to display once, cleared by the UI. */
  offlineReport: OfflineReport | null;
  /**
   * Generators that became available during the offline catch-up, set by
   * `hydrate` and cleared by the UI once it has shown them.
   *
   * WHY THIS LIVES IN THE STORE
   * ---------------------------
   * A panel-level watcher cannot detect this. Generators unlock *during* the
   * offline walk, but by the time any component mounts they are already unlocked,
   * so a snapshot diff looks identical to a restored save. Comparing before and
   * after is only possible where both states exist, which is here.
   *
   * That distinction is the whole feature: a player returning after sixteen hours
   * should see the two generators that arrived while they were asleep announce
   * themselves, and a player who reloaded a moment later should see nothing.
   */
  pendingArrivals: GeneratorId[];
  /**
   * Achievements earned but not yet announced, cleared by the UI.
   *
   * Mirrors `pendingArrivals` deliberately: both are "something happened that the
   * player should be told about", both are drained by the presentation layer, and
   * neither is a save concern.
   *
   * Empty after `hydrate` on purpose. A returning player already gets the offline
   * dialog naming what they earned, and the achievements panel lists everything;
   * announcing a backlog of milestones on top of that is noise, not news.
   */
  pendingAchievements: AchievementId[];
  /** Set when a load rejected a save, so the UI can warn the player. */
  loadWarning: string | null;
  /** How many seconds of real play time this session (not persisted until save). */
  sessionSeconds: number;

  // --- lifecycle ---
  hydrate: () => 'current' | 'backup' | 'fresh';
  tick: (deltaSeconds: number) => void;
  /** Credit time the tab spent hidden, at offline efficiency. */
  catchUp: (elapsedMs: number) => void;
  save: () => boolean;
  loadFromString: (json: string) => PurchaseResult;
  exportSave: () => string | null;
  hardReset: () => void;

  // --- actions ---
  buyGenerator: (id: GeneratorId, amount?: BuyAmount) => PurchaseResult;
  purchaseUpgrade: (id: UpgradeId) => PurchaseResult;
  performPrestige: () => PurchaseResult;
  purchasePermUpgrade: (id: PermUpgradeId) => PurchaseResult;

  // --- dev tools ---
  /**
   * Add resources directly, for the debug panel.
   *
   * Goes through the store rather than mutating `gameState.resources` in place:
   * a direct write leaves `tickVersion` unchanged and does not refresh the
   * production snapshot, so generator cards would keep showing a stale rate.
   */
  grantResources: (resource: ResourceId, amount: Decimal) => void;

  // --- ui ---
  dismissOfflineReport: () => void;
  /**
   * Called by the UI once arrivals have been shown, so a reload does not replay
   * them. Separate from dismissing the report because the two are not the same
   * moment: the modal is dismissed immediately, the arrivals play after it.
   */
  clearPendingArrivals: () => void;
  /**
   * Called once the unlock has been announced, so the next tick does not announce
   * it again. Same contract as `clearPendingArrivals`, for the same reason.
   */
  clearPendingAchievements: () => void;
  setSaveStatus: (status: TransientState['save']['status']) => void;
}

/** Recompute the multiplier-derived bits the UI needs on every tick. */
function deriveTransient(state: GameState, previous: TransientState): TransientState {
  const mult = computeMultipliers(state);
  return {
    ...previous,
    lastTickAt: state.lastTickAt,
    tickVersion: state.tickVersion,
    costDiscount: mult.costDiscount,
    costGrowthDelta: mult.costGrowthDelta,
  };
}

export const useGameStore = create<GameStoreState>()((set, get) => ({
  gameState: createInitialState(),
  transient: {
    lastTickAt: Date.now(),
    tickVersion: 0,
    production: emptyProduction(),
    costDiscount: dec(1),
    costGrowthDelta: 0,
    save: { status: 'idle', lastSavedAt: getLastSavedAt() },
  },
  offlineReport: null,
  pendingArrivals: [],
  pendingAchievements: [],
  loadWarning: null,
  sessionSeconds: 0,

  // -------------------------------------------------------------------------
  // hydrate — load the save, then credit offline time
  // -------------------------------------------------------------------------
  hydrate: () => {
    const now = Date.now();
    const result = loadGameState(now);
    const elapsedMs = Math.max(0, now - result.state.lastTickAt);

    if (elapsedMs / 1000 < MIN_OFFLINE_SECONDS_FOR_REPORT) {
      // Too short an absence to report: anchor the clock, but still publish a
      // production snapshot so the UI shows real rates before the first tick.
      const anchored: GameState = { ...result.state, lastTickAt: now };
      const production = computeProductionSnapshot(anchored);
      // Achievements are still credited here. "Too brief an absence" is a claim
      // about the OFFLINE REPORT, not about whether the loaded save already met a
      // milestone — a save hand-edited or imported from elsewhere can arrive with
      // its conditions met and a two-second timestamp gap. Left out of this branch,
      // the next tick would quietly repair it, which hides the omission rather
      // than preventing it.
      const earned = applyAchievements(anchored, now);
      set({
        gameState: earned.state,
        transient: deriveTransient(earned.state, { ...get().transient, production }),
        loadWarning: result.error ?? null,
        offlineReport: null,
        // Too brief an absence to have unlocked anything.
        pendingArrivals: [],
        pendingAchievements: [],
      });
      return result.source;
    }

    // Generators unlocked by the offline walk.
    //
    // Snapshot the unlocked flags BEFORE the walk. `applyOfflineProgress` copies
    // the generators map but not the per-generator objects inside it, and
    // `engineTick` sets `.unlocked = true` in place -- so after the walk
    // `result.state` and `state` are the *same objects* and a diff between them
    // always comes back empty. Comparing after the fact silently reported zero
    // arrivals for every return visit, which is the bug this fixes.
    const unlockedBefore = new Set(
      GENERATOR_IDS.filter((id) => result.state.generators[id].unlocked)
    );

    const { state, report } = applyOfflineProgress(result.state, elapsedMs, now);
    const production = engineTick(state, 0, now);

    const arrivals = GENERATOR_IDS.filter(
      (id) => !unlockedBefore.has(id) && state.generators[id].unlocked
    );

    // Credit the achievements the offline walk earned, but do NOT announce them.
    // The modal is already telling the player what they earned while away, and a
    // backlog of "Achievement unlocked" announcements stacked on top of it is
    // noise. The panel still shows them; they are simply not news on return.
    const earned = applyAchievements(state, now);

    set({
      gameState: earned.state,
      transient: deriveTransient(earned.state, { ...get().transient, production }),
      loadWarning: result.error ?? null,
      offlineReport: report.trivial ? null : report,
      // Only meaningful alongside a report: without one the player was away too
      // briefly for anything to have unlocked.
      pendingArrivals: report.trivial ? [] : arrivals,
      pendingAchievements: [],
    });
    return result.source;
  },

  // -------------------------------------------------------------------------
  // tick — the only thing that advances the simulation
  // -------------------------------------------------------------------------
  tick: (deltaSeconds: number) => {
    const { gameState, transient } = get();
    const clamped = Math.min(Math.max(0, deltaSeconds), MAX_DELTA_SECONDS);
    if (clamped <= 0) return;

    const draft = cloneForEngine(gameState);
    const production = engineTick(draft, clamped);
    // The only path that can earn the lifetime-total achievements, since those
    // climb from production rather than from anything the player clicks.
    const { state: next, newlyUnlocked } = applyAchievements(draft, Date.now());

    set({
      gameState: next,
      transient: { ...transient, production, lastTickAt: next.lastTickAt, tickVersion: next.tickVersion },
      sessionSeconds: get().sessionSeconds + clamped,
      ...(newlyUnlocked.length > 0 ? { pendingAchievements: newlyUnlocked } : {}),
    });
  },

  // -------------------------------------------------------------------------
  // catchUp — the tab was hidden; credit that time at offline efficiency
  // -------------------------------------------------------------------------
  catchUp: (elapsedMs: number) => {
    const seconds = Math.max(0, elapsedMs) / 1000;
    if (seconds < MIN_OFFLINE_SECONDS_FOR_REPORT) return;

    const now = Date.now();
    const { state, report } = applyOfflineProgress(get().gameState, elapsedMs, now);
    const production = engineTick(state, 0, now);
    const { state: earned, pending } = withAchievements(state);

    set({
      gameState: earned,
      transient: {
        ...get().transient,
        production,
        lastTickAt: earned.lastTickAt,
        tickVersion: earned.tickVersion,
      },
      // Only interrupt with a modal when the player was away long enough and
      // actually earned something.
      offlineReport: report.trivial ? null : report,
      pendingAchievements: pending,
    });
  },

  // -------------------------------------------------------------------------
  // dev tools
  // -------------------------------------------------------------------------
  grantResources: (resource, amount) => {
    const { gameState, transient } = get();
    const next: GameState = {
      ...gameState,
      resources: {
        ...gameState.resources,
        [resource]: gameState.resources[resource].plus(amount),
      },
      tickVersion: gameState.tickVersion + 1,
    };
    // Refresh the snapshot so cards reflect the new stock immediately.
    const production = computeProductionSnapshot(next);
    const { state: withEarned, pending } = withAchievements(next);
    set({
      gameState: withEarned,
      transient: { ...transient, production, tickVersion: withEarned.tickVersion },
      pendingAchievements: pending,
    });
  },

  // -------------------------------------------------------------------------
  // buyGenerator
  // -------------------------------------------------------------------------
  buyGenerator: (id, amount = 1) => {
    const { gameState, transient } = get();
    const def = genDef(id);
    if (!def) return { ok: false, error: `Unknown generator: ${id}` };

    const genState = gameState.generators[def.id];
    if (!genState) return { ok: false, error: `Unknown generator: ${id}` };
    if (!genState.unlocked) return { ok: false, error: `${def.name} is locked` };

    const mult = computeMultipliers(gameState);
    const growth = effectiveCostGrowth(def.costGrowth, mult.costGrowthDelta);

    let count: number;
    let cost: Decimal;
    if (amount === 'max') {
      count = maxAffordable(def.baseCost, growth, genState.owned, gameState.resources.cash, mult.costDiscount);
      if (count <= 0) return { ok: false, error: 'Not enough cash', count: 0 };
      cost = costForBulkPurchase(def.baseCost, growth, genState.owned, count, mult.costDiscount);
    } else {
      count = Math.max(1, Math.floor(amount));
      cost = costForBulkPurchase(def.baseCost, growth, genState.owned, count, mult.costDiscount);
    }

    if (gameState.resources.cash.lessThan(cost)) {
      return { ok: false, error: 'Not enough cash', count: 0 };
    }

    const generators = {
      ...gameState.generators,
      [def.id]: { ...genState, owned: genState.owned + count },
    };
    const resources = { ...gameState.resources, cash: gameState.resources.cash.minus(cost) };
    const stats = { ...gameState.stats, manualClicks: gameState.stats.manualClicks + 1 };

    const candidate: GameState = {
      ...gameState,
      generators,
      resources,
      stats,
      tickVersion: gameState.tickVersion + 1,
    };

    const { state: next, pending } = withAchievements(candidate);

    set({
      gameState: next,
      transient: { ...transient, tickVersion: next.tickVersion },
      pendingAchievements: pending,
    });
    return { ok: true, count };
  },

  // -------------------------------------------------------------------------
  // purchaseUpgrade
  // -------------------------------------------------------------------------
  purchaseUpgrade: (id) => {
    const { gameState, transient } = get();
    const def = upgradeDef(id);
    if (!def) return { ok: false, error: `Unknown upgrade: ${id}` };
    if (gameState.upgrades.purchased.includes(id)) return { ok: false, error: 'Already purchased' };

    const req = meetsUpgradeRequirements(gameState, def);
    if (!req.met) return { ok: false, error: req.reason };
    if (!canAffordUpgrade(gameState, def)) return { ok: false, error: 'Not enough resources' };

    const resources = {
      ...gameState.resources,
      [def.cost.resource]: gameState.resources[def.cost.resource].minus(def.cost.amount),
    } as GameState['resources'];
    const upgrades = { purchased: [...gameState.upgrades.purchased, id] };

    const candidate: GameState = {
      ...gameState,
      resources,
      upgrades,
      stats: { ...gameState.stats, manualClicks: gameState.stats.manualClicks + 1 },
      tickVersion: gameState.tickVersion + 1,
    };

    const { state: next, pending } = withAchievements(candidate);

    // Re-derive so a newly applicable generator unlock shows up immediately.
    const production = engineTick(next, 0, next.lastTickAt);

    set({
      gameState: next,
      transient: {
        ...deriveTransient(next, transient),
        production,
        tickVersion: next.tickVersion,
      },
      pendingAchievements: pending,
    });
    return OK;
  },

  // -------------------------------------------------------------------------
  // performPrestige
  // -------------------------------------------------------------------------
  performPrestige: () => {
    const { gameState, transient } = get();
    if (!canPrestige(gameState)) return { ok: false, error: 'Not enough lifetime cash to reset' };

    const reset = resetForPrestige(gameState);
    const { state: next, pending } = withAchievements(reset);
    const production = engineTick(next, 0, next.lastTickAt);

    set({
      gameState: next,
      transient: {
        ...deriveTransient(next, transient),
        production,
        tickVersion: next.tickVersion,
      },
      sessionSeconds: 0,
      pendingAchievements: pending,
    });
    return OK;
  },

  // -------------------------------------------------------------------------
  // purchasePermUpgrade
  // -------------------------------------------------------------------------
  purchasePermUpgrade: (id) => {
    const { gameState, transient } = get();
    const cost = permUpgradeCost(gameState, id);
    if (!cost) return { ok: false, error: `Unknown permanent upgrade: ${id}` };

    const { state: purchased, ok, error } = purchasePermUpgrade(gameState, id);
    if (!ok) return { ok: false, error };

    const { state, pending } = withAchievements(purchased);
    const production = engineTick(state, 0, state.lastTickAt);
    set({
      gameState: state,
      transient: {
        ...deriveTransient(state, transient),
        production,
        tickVersion: state.tickVersion,
      },
      pendingAchievements: pending,
    });
    return { ok: true, spent: cost };
  },

  // -------------------------------------------------------------------------
  // persistence
  // -------------------------------------------------------------------------
  save: () => {
    const { gameState, transient } = get();
    const now = Date.now();
    set({ transient: { ...transient, save: { ...transient.save, status: 'saving' } } });

    const ok = saveGameState(gameState, now);
    set({
      transient: {
        ...get().transient,
        save: { status: ok ? 'saved' : 'error', lastSavedAt: ok ? now : get().transient.save.lastSavedAt },
      },
    });
    return ok;
  },

  loadFromString: (json) => {
    try {
      const state = deserializeState(json);
      const production = engineTick(state, 0, state.lastTickAt);
      set({
        gameState: state,
        transient: {
          ...get().transient,
          production,
          lastTickAt: state.lastTickAt,
          tickVersion: state.tickVersion,
        },
        offlineReport: null,
        // An imported save is a snapshot, not an absence -- nothing arrived while
        // the player was looking at a file picker.
        pendingArrivals: [],
        // For the same reason: the imported file already records what it contains,
        // so nothing new was earned and nothing should announce itself.
        pendingAchievements: [],
        loadWarning: null,
      });
      return OK;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  },

  exportSave: () => serializeState(get().gameState),

  hardReset: () => {
    clearSaveData();
    const fresh = createInitialState();
    set({
      gameState: fresh,
      transient: {
        lastTickAt: fresh.lastTickAt,
        tickVersion: 0,
        production: emptyProduction(),
        costDiscount: dec(1),
        costGrowthDelta: 0,
        save: { status: 'idle', lastSavedAt: null },
      },
      offlineReport: null,
      pendingArrivals: [],
      pendingAchievements: [],
      loadWarning: null,
      sessionSeconds: 0,
    });
  },

  // -------------------------------------------------------------------------
  // ui
  // -------------------------------------------------------------------------
  dismissOfflineReport: () => set({ offlineReport: null }),
  clearPendingArrivals: () => set({ pendingArrivals: [] }),
  clearPendingAchievements: () => set({ pendingAchievements: [] }),

  setSaveStatus: (status) =>
    set((s) => ({ transient: { ...s.transient, save: { ...s.transient.save, status } } })),
}));

// ---------------------------------------------------------------------------
// Derived selectors — kept out of components so there is one definition each.
// ---------------------------------------------------------------------------

export function selectCash(state: GameStoreState): Decimal {
  return state.gameState.resources.cash;
}

export function selectLoC(state: GameStoreState): Decimal {
  return state.gameState.resources.linesOfCode;
}

export function selectCoffee(state: GameStoreState): Decimal {
  return state.gameState.resources.coffee;
}

export function selectTechDebt(state: GameStoreState): Decimal {
  return state.gameState.prestige.techDebt;
}

export { UPGRADE_DEFS, PERM_UPGRADE_DEFS, computeTechDebtGained };
