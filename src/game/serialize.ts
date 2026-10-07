/**
 * Save serialization / deserialization for IDEV : ADMIN.
 *
 * Every Decimal is stored as a plain string so JSON round-trips cleanly, and is
 * re-hydrated with `Decimal.fromString` on load.
 *
 * Two invariants this module owns:
 *   1. ONE canonical save format (v1). The previous build had two writers — the
 *      store emitted `upgrades: string[]`, serializeState emitted
 *      `upgrades: { purchased: [...] }` — and each reader understood only its own.
 *   2. Loading never throws on hostile input. `deserializeState` either returns a
 *      valid GameState or throws a plain Error the caller can quarantine; every
 *      individual field is validated and clamped.
 */
import type { GameState, GeneratorId, PermUpgradeId, SaveBlob, UpgradeId } from './types';
import { GENERATOR_IDS, RESOURCE_IDS } from './types';
import { dec, decSafe, intSafe, numSafe, ZERO } from './decimal';
import { UPGRADE_DEFS } from './upgrades';
import { PERM_UPGRADE_DEFS } from './permUpgrades';
import { CURRENT_SAVE_VERSION } from './prestige';
import { requireGenDef } from './generators';

const KNOWN_UPGRADE_IDS = new Set<UpgradeId>(UPGRADE_DEFS.map((u) => u.id));
const KNOWN_PERM_IDS = new Set<PermUpgradeId>(PERM_UPGRADE_DEFS.map((u) => u.id));

/**
 * Starting cash for a brand-new game.
 *
 * Without this the game is softlocked: the cheapest generator costs
 * STARTING_CASH_TIERS times this amount, and a fresh state has no resources and
 * no production, so there is no way to earn the first one.
 */
export const STARTING_CASH = 25;

/** A brand-new game at the current schema version. */
export function createInitialState(now: number = Date.now()): GameState {
  const generators = {} as GameState['generators'];
  for (const id of GENERATOR_IDS) {
    generators[id] = { owned: 0, unlocked: id === 'juniorDev' };
  }

  return {
    version: CURRENT_SAVE_VERSION,
    resources: {
      linesOfCode: ZERO,
      coffee: ZERO,
      cash: dec(STARTING_CASH),
      lifetimeCash: ZERO,
    },
    generators,
    upgrades: { purchased: [] },
    stats: {
      playSeconds: 0,
      runCashEarned: ZERO,
      totalCashEarned: ZERO,
      totalLinesMined: ZERO,
      manualClicks: 0,
      prestigeCount: 0,
    },
    prestige: {
      techDebt: ZERO,
      permanentUpgrades: {},
      totalTechDebtEarned: ZERO,
      bestRunLifetimeCash: ZERO,
      baselineLifetimeCash: ZERO,
    },
    lastTickAt: now,
    tickVersion: 0,
  };
}

/** Clamp a Decimal resource to a sane, non-negative value. */
function safeResource(value: unknown) {
  const parsed = decSafe(value, ZERO);
  return parsed.lessThan(ZERO) ? ZERO : parsed;
}

/** Accept both the v0 array shape and the v1 array shape. */
function readUpgradeIds(raw: unknown): UpgradeId[] {
  const collect = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
    if (value && typeof value === 'object') {
      const purchased = (value as { purchased?: unknown }).purchased;
      if (Array.isArray(purchased)) {
        return purchased.filter((v): v is string => typeof v === 'string');
      }
    }
    return [];
  };

  const ids = collect(raw);
  // Unknown ids are dropped rather than preserved: a removed upgrade must not
  // linger in a save and keep applying effects.
  return ids.filter((id) => KNOWN_UPGRADE_IDS.has(id));
}

/** Keep only known permanent upgrade ids with sane counts. */
function readPermanentUpgrades(raw: unknown): Record<PermUpgradeId, number> {
  const out: Record<PermUpgradeId, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  const source = raw as Record<string, unknown>;
  for (const id of KNOWN_PERM_IDS) {
    const count = intSafe(source[id], 0);
    if (count > 0) out[id] = count;
  }
  return out;
}

/** Serialize a GameState into the canonical save string. */
export function serializeState(state: GameState, now: number = Date.now()): string {
  const blob: SaveBlob = {
    version: CURRENT_SAVE_VERSION,
    savedAt: now,
    resources: {
      linesOfCode: state.resources.linesOfCode.toString(),
      coffee: state.resources.coffee.toString(),
      cash: state.resources.cash.toString(),
      lifetimeCash: state.resources.lifetimeCash.toString(),
    },
    generators: GENERATOR_IDS.reduce(
      (acc, id) => {
        acc[id] = state.generators[id]?.owned ?? 0;
        return acc;
      },
      {} as Record<GeneratorId, number>
    ),
    upgrades: state.upgrades.purchased,
    stats: {
      playSeconds: numSafe(state.stats.playSeconds, 0),
      manualClicks: intSafe(state.stats.manualClicks, 0),
      prestigeCount: intSafe(state.stats.prestigeCount, 0),
      runCashEarned: state.stats.runCashEarned.toString(),
      totalCashEarned: state.stats.totalCashEarned.toString(),
      totalLinesMined: state.stats.totalLinesMined.toString(),
    },
    prestige: {
      techDebt: state.prestige.techDebt.toString(),
      totalTechDebtEarned: state.prestige.totalTechDebtEarned.toString(),
      permanentUpgrades: state.prestige.permanentUpgrades,
      bestRunLifetimeCash: state.prestige.bestRunLifetimeCash.toString(),
      baselineLifetimeCash: state.prestige.baselineLifetimeCash.toString(),
    },
    lastTickAt: numSafe(state.lastTickAt, now),
    tickVersion: intSafe(state.tickVersion, 0),
  };

  return JSON.stringify(blob);
}

/**
 * Migrate a raw parsed blob forward to the current schema version.
 * v0 (the pre-release format) is missing lifetimeCash, runCashEarned and the
 * prestige bookkeeping fields, so they are derived where possible and defaulted
 * otherwise.
 */
function migrateBlob(raw: Record<string, unknown>, now: number): SaveBlob {
  const fromVersion = intSafe(raw.version, 0);
  const resources = (raw.resources ?? {}) as Record<string, unknown>;
  const stats = (raw.stats ?? {}) as Record<string, unknown>;
  const prestige = (raw.prestige ?? {}) as Record<string, unknown>;

  const lifetimeCashRaw = resources.lifetimeCash ?? stats.totalCashEarned;

  const blob: SaveBlob = {
    version: CURRENT_SAVE_VERSION,
    savedAt: numSafe(raw.savedAt, now),
    resources: {
      linesOfCode: decSafe(resources.linesOfCode, ZERO).toString(),
      coffee: decSafe(resources.coffee, ZERO).toString(),
      cash: decSafe(resources.cash, ZERO).toString(),
      lifetimeCash: decSafe(lifetimeCashRaw, ZERO).toString(),
    },
    generators: GENERATOR_IDS.reduce(
      (acc, id) => {
        acc[id] = intSafe((raw.generators as Record<string, unknown> | undefined)?.[id], 0);
        return acc;
      },
      {} as Record<GeneratorId, number>
    ),
    upgrades: readUpgradeIds(raw.upgrades),
    stats: {
      playSeconds: numSafe(stats.playSeconds, 0),
      manualClicks: intSafe(stats.manualClicks, 0),
      prestigeCount: intSafe(stats.prestigeCount ?? stats.runCount, 0),
      runCashEarned: decSafe(stats.runCashEarned, decSafe(stats.totalCashEarned, ZERO)).toString(),
      totalCashEarned: decSafe(stats.totalCashEarned, ZERO).toString(),
      totalLinesMined: decSafe(stats.totalLinesMined, ZERO).toString(),
    },
    prestige: {
      techDebt: decSafe(prestige.techDebt, ZERO).toString(),
      totalTechDebtEarned: decSafe(
        prestige.totalTechDebtEarned ?? prestige.techDebt,
        ZERO
      ).toString(),
      permanentUpgrades: readPermanentUpgrades(prestige.permanentUpgrades),
      bestRunLifetimeCash: decSafe(prestige.bestRunLifetimeCash ?? lifetimeCashRaw, ZERO).toString(),
      // Pre-baseline saves had every lifetime cash dollar still claimable, which is
      // exactly how the farming exploit worked. Assume it was already banked.
      baselineLifetimeCash: decSafe(
        prestige.baselineLifetimeCash ?? lifetimeCashRaw,
        ZERO
      ).toString(),
    },
    lastTickAt: numSafe(raw.lastTickAt, now),
    tickVersion: intSafe(raw.tickVersion, 0),
  };

  // A future schema version is not readable; refuse rather than silently truncate.
  if (fromVersion > CURRENT_SAVE_VERSION) {
    throw new Error(`Save version ${fromVersion} is newer than supported version ${CURRENT_SAVE_VERSION}`);
  }

  return blob;
}

/** Parse a save string into a validated SaveBlob. Throws on unusable input. */
export function parseSaveBlob(json: string, now: number = Date.now()): SaveBlob {
  if (typeof json !== 'string' || json.trim().length === 0) {
    throw new Error('Save is empty');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new Error(`Save is not valid JSON: ${(err as Error).message}`);
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Save is not an object');
  }

  const record = raw as Record<string, unknown>;
  if (!record.resources || typeof record.resources !== 'object') {
    throw new Error('Save is missing a resources block');
  }

  return migrateBlob(record, now);
}

/** Parse a save string straight into a GameState. */
export function deserializeState(json: string, now: number = Date.now()): GameState {
  const blob = parseSaveBlob(json, now);
  const generators = {} as GameState['generators'];

  const lifetimeCash = safeResource(blob.resources.lifetimeCash);
  const cash = safeResource(blob.resources.cash);
  const totalOwned = GENERATOR_IDS.reduce((sum, id) => sum + intSafe(blob.generators[id], 0), 0);

  for (const id of GENERATOR_IDS) {
    const owned = intSafe(blob.generators[id], 0);
    // Owned generators stay unlocked; otherwise re-derive from lifetime cash so
    // an old save cannot come back with every generator greyed out.
    const threshold = requireGenDef(id).unlockAt.lifetimeCash;
    generators[id] = {
      owned,
      unlocked: owned > 0 || id === 'juniorDev' || lifetimeCash.greaterThanOrEqualTo(threshold),
    };
  }

  // Top up a save that is verifiably a fresh start (nothing bought, nothing
  // earned) so an old save cannot remain softlocked. A save with real progress
  // is left exactly as it was.
  const isFreshStart =
    totalOwned === 0 &&
    lifetimeCash.eq(ZERO) &&
    !lifetimeCash.greaterThan(ZERO) &&
    cash.lessThan(requireGenDef('juniorDev').baseCost);
  const resolvedCash = isFreshStart ? dec(STARTING_CASH) : cash;

  return {
    version: CURRENT_SAVE_VERSION,
    resources: {
      linesOfCode: safeResource(blob.resources.linesOfCode),
      coffee: safeResource(blob.resources.coffee),
      cash: resolvedCash,
      lifetimeCash: safeResource(blob.resources.lifetimeCash),
    },
    generators,
    upgrades: { purchased: readUpgradeIds(blob.upgrades) },
    stats: {
      playSeconds: numSafe(blob.stats.playSeconds, 0),
      runCashEarned: safeResource(blob.stats.runCashEarned),
      totalCashEarned: safeResource(blob.stats.totalCashEarned),
      totalLinesMined: safeResource(blob.stats.totalLinesMined),
      manualClicks: intSafe(blob.stats.manualClicks, 0),
      prestigeCount: intSafe(blob.stats.prestigeCount, 0),
    },
    prestige: {
      techDebt: safeResource(blob.prestige.techDebt),
      totalTechDebtEarned: safeResource(blob.prestige.totalTechDebtEarned),
      permanentUpgrades: readPermanentUpgrades(blob.prestige.permanentUpgrades),
      bestRunLifetimeCash: safeResource(blob.prestige.bestRunLifetimeCash),
      baselineLifetimeCash: safeResource(blob.prestige.baselineLifetimeCash),
    },
    lastTickAt: numSafe(blob.lastTickAt, now),
    tickVersion: intSafe(blob.tickVersion, 0),
  };
}

/** Resource ids exported for tests / tooling. */
export const SAVED_RESOURCES = RESOURCE_IDS;
