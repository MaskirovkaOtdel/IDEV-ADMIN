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
  UpgradeId,
} from './types';
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

export interface GameStoreState {
  gameState: GameState;
  transient: TransientState;
  /** Offline report to display once, cleared by the UI. */
  offlineReport: OfflineReport | null;
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

  // --- ui ---
  dismissOfflineReport: () => void;
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
      set({
        gameState: anchored,
        transient: deriveTransient(anchored, { ...get().transient, production }),
        loadWarning: result.error ?? null,
        offlineReport: null,
      });
      return result.source;
    }

    const { state, report } = applyOfflineProgress(result.state, elapsedMs, now);
    const production = engineTick(state, 0, now);

    set({
      gameState: state,
      transient: deriveTransient(state, { ...get().transient, production }),
      loadWarning: result.error ?? null,
      offlineReport: report.trivial ? null : report,
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

    set({
      gameState: draft,
      transient: { ...transient, production, lastTickAt: draft.lastTickAt, tickVersion: draft.tickVersion },
      sessionSeconds: get().sessionSeconds + clamped,
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

    set({
      gameState: state,
      transient: {
        ...get().transient,
        production,
        lastTickAt: state.lastTickAt,
        tickVersion: state.tickVersion,
      },
      // Only interrupt with a modal when the player was away long enough and
      // actually earned something.
      offlineReport: report.trivial ? null : report,
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

    const next: GameState = {
      ...gameState,
      generators,
      resources,
      stats,
      tickVersion: gameState.tickVersion + 1,
    };

    set({
      gameState: next,
      transient: { ...transient, tickVersion: next.tickVersion },
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

    const next: GameState = {
      ...gameState,
      resources,
      upgrades,
      stats: { ...gameState.stats, manualClicks: gameState.stats.manualClicks + 1 },
      tickVersion: gameState.tickVersion + 1,
    };

    // Re-derive so a newly applicable generator unlock shows up immediately.
    const production = engineTick(next, 0, next.lastTickAt);

    set({
      gameState: next,
      transient: {
        ...deriveTransient(next, transient),
        production,
        tickVersion: next.tickVersion,
      },
    });
    return OK;
  },

  // -------------------------------------------------------------------------
  // performPrestige
  // -------------------------------------------------------------------------
  performPrestige: () => {
    const { gameState, transient } = get();
    if (!canPrestige(gameState)) return { ok: false, error: 'Not enough lifetime cash to reset' };

    const next = resetForPrestige(gameState);
    const production = engineTick(next, 0, next.lastTickAt);

    set({
      gameState: next,
      transient: {
        ...deriveTransient(next, transient),
        production,
        tickVersion: next.tickVersion,
      },
      sessionSeconds: 0,
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

    const { state, ok, error } = purchasePermUpgrade(gameState, id);
    if (!ok) return { ok: false, error };

    const production = engineTick(state, 0, state.lastTickAt);
    set({
      gameState: state,
      transient: {
        ...deriveTransient(state, transient),
        production,
        tickVersion: state.tickVersion,
      },
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
      loadWarning: null,
      sessionSeconds: 0,
    });
  },

  // -------------------------------------------------------------------------
  // ui
  // -------------------------------------------------------------------------
  dismissOfflineReport: () => set({ offlineReport: null }),

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
