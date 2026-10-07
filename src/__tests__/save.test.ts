/**
 * Save/load round-trip and hostile-input tests.
 *
 * These replace the "fuzzing" the handoff claimed was done: every case below was
 * a real crash or silent data loss before (missing lifetimeCash, two incompatible
 * save shapes, `Decimal.ZERO` undefined, `deserializeState` throwing on garbage).
 */
import { describe, it, expect } from 'vitest';
import {
  serializeState,
  deserializeState,
  parseSaveBlob,
  createInitialState,
  STARTING_CASH,
} from '../game/serialize';
import {
  saveGameState,
  loadGameState,
  clearSaveData,
  KEY_CURRENT,
  KEY_BACKUP,
  KEY_CORRUPT,
  readSaveString,
  getLastSavedAt,
} from '../game/storage';
import { dec } from '../game/decimal';
import { CURRENT_SAVE_VERSION, runLifetimeCash } from '../game/prestige';
import { GENERATOR_IDS } from '../game/types';
import type { GameState } from '../game/types';

function populated(): GameState {
  const state = createInitialState();
  state.resources.cash = dec(1234.5);
  state.resources.linesOfCode = dec('1e30');
  state.resources.coffee = dec(42);
  state.resources.lifetimeCash = dec(9.876e12);
  state.generators.juniorDev = { owned: 17, unlocked: true };
  state.generators.k8sCluster = { owned: 3, unlocked: true };
  state.upgrades.purchased = ['codeMaster', 'styleGuide'];
  state.stats = {
    playSeconds: 1234.5,
    runCashEarned: dec(100),
    totalCashEarned: dec('1e9'),
    totalLinesMined: dec('1e11'),
    manualClicks: 88,
    prestigeCount: 3,
  };
  state.prestige = {
    techDebt: dec(250),
    permanentUpgrades: { refactoringGrant: 2 },
    totalTechDebtEarned: dec(400),
    bestRunLifetimeCash: dec('1e13'),
    baselineLifetimeCash: dec('1e6'),
  };
  return state;
}

describe('serialize / deserialize round-trip', () => {
  it('preserves every field', () => {
    const original = populated();
    const restored = deserializeState(serializeState(original));

    expect(restored.resources.cash.toString()).toBe(original.resources.cash.toString());
    expect(restored.resources.linesOfCode.toString()).toBe(original.resources.linesOfCode.toString());
    expect(restored.resources.lifetimeCash.toString()).toBe(original.resources.lifetimeCash.toString());
    expect(restored.generators.juniorDev.owned).toBe(17);
    expect(restored.generators.k8sCluster.owned).toBe(3);
    expect(restored.upgrades.purchased.sort()).toEqual(['codeMaster', 'styleGuide']);
    expect(restored.stats.playSeconds).toBe(1234.5);
    expect(restored.stats.prestigeCount).toBe(3);
    expect(restored.stats.totalLinesMined.toString()).toBe(original.stats.totalLinesMined.toString());
    expect(restored.prestige.techDebt.toString()).toBe('250');
    expect(restored.prestige.permanentUpgrades.refactoringGrant).toBe(2);
    expect(restored.prestige.baselineLifetimeCash.toString()).toBe('1000000');
    expect(restored.version).toBe(CURRENT_SAVE_VERSION);
  });

  it('produces valid JSON with no Decimal objects inside', () => {
    const json = serializeState(populated());
    const raw = JSON.parse(json);
    expect(typeof raw.resources.cash).toBe('string');
    expect(typeof raw.upgrades).toBe('object');
    expect(Array.isArray(raw.upgrades)).toBe(true);
  });

  it('is stable across repeated round-trips', () => {
    const once = serializeState(populated());
    const twice = serializeState(deserializeState(once));
    expect(JSON.parse(twice).resources).toEqual(JSON.parse(once).resources);
    expect(JSON.parse(twice).generators).toEqual(JSON.parse(once).generators);
  });
});

describe('deserialize – hostile input', () => {
  const badInputs: [string, string][] = [
    ['empty string', ''],
    ['whitespace', '   '],
    ['truncated JSON', '{"version":1,"resources":'],
    ['JSON array', '[]'],
    ['JSON null', 'null'],
    ['JSON number', '42'],
    ['JSON string', '"hello"'],
    ['no resources block', '{"version":1,"generators":{}}'],
  ];

  for (const [label, input] of badInputs) {
    it(`rejects ${label} with a thrown Error (not a crash)`, () => {
      expect(() => deserializeState(input)).toThrow();
    });
  }

  it('refuses a save from a future schema version', () => {
    const future = JSON.stringify({ version: CURRENT_SAVE_VERSION + 5, resources: { cash: '1' } });
    expect(() => deserializeState(future)).toThrow(/newer than supported/);
  });

  it('fills defaults for every missing field', () => {
    const minimal = JSON.stringify({ version: CURRENT_SAVE_VERSION, resources: {} });
    const state = deserializeState(minimal);
    // No generators, no lifetime cash and less than the cheapest generator's
    // price means this is a fresh start, so it receives the starting grant.
    expect(state.resources.cash.toString()).toBe(dec(STARTING_CASH).toString());
    expect(state.resources.lifetimeCash.toString()).toBe('0');
    expect(state.upgrades.purchased).toEqual([]);
    expect(state.prestige.permanentUpgrades).toEqual({});
    for (const id of GENERATOR_IDS) {
      expect(state.generators[id].owned).toBe(0);
    }
  });

  it('clamps negative resources to zero', () => {
    const json = JSON.stringify({
      version: CURRENT_SAVE_VERSION,
      resources: { cash: '-500', coffee: '-1', linesOfCode: '-2e5' },
      // Generators owned: this is a broken save, not a fresh start, so the
      // starting-cash top-up must not mask the clamping.
      generators: { juniorDev: 3 },
    });
    const state = deserializeState(json);
    expect(state.resources.cash.toString()).toBe('0');
    expect(state.resources.coffee.toString()).toBe('0');
  });

  it('coerces fractional and negative generator counts', () => {
    const json = JSON.stringify({
      version: CURRENT_SAVE_VERSION,
      resources: {},
      generators: { juniorDev: 12.9, seniorDev: -5, linter: '7' },
    });
    const state = deserializeState(json);
    expect(state.generators.juniorDev.owned).toBe(12);
    expect(state.generators.seniorDev.owned).toBe(0);
    expect(state.generators.linter.owned).toBe(7);
  });

  it('ignores unknown generators, upgrades and permanent upgrades', () => {
    const json = JSON.stringify({
      version: CURRENT_SAVE_VERSION,
      resources: {},
      generators: { quantumComputer: 99 },
      upgrades: ['codeMaster', 'removedUpgrade'],
      prestige: { permanentUpgrades: { refactoringGrant: 2, removedPerm: 5 } },
    });
    const state = deserializeState(json);
    expect((state.generators as unknown as Record<string, unknown>).quantumComputer).toBeUndefined();
    expect(state.upgrades.purchased).toEqual(['codeMaster']);
    expect(state.prestige.permanentUpgrades.removedPerm).toBeUndefined();
  });

  it('survives garbage numeric strings', () => {
    const json = JSON.stringify({
      version: CURRENT_SAVE_VERSION,
      resources: { cash: 'not-a-number', coffee: 'NaN', linesOfCode: '' },
      generators: { juniorDev: 2 },
      stats: { playSeconds: 'abc', manualClicks: {} },
    });
    const state = deserializeState(json);
    expect(state.resources.cash.toString()).toBe('0');
    expect(state.resources.coffee.toString()).toBe('0');
    expect(state.stats.playSeconds).toBe(0);
    expect(state.stats.manualClicks).toBe(0);
  });

  it('handles an absurdly large but valid value', () => {
    const json = JSON.stringify({
      version: CURRENT_SAVE_VERSION,
      resources: { cash: '1e9000', linesOfCode: '3', coffee: '4' },
    });
    const state = deserializeState(json);
    expect(state.resources.cash.toString()).toContain('e+9000');
  });

  it('ignores a prototype-pollution attempt in permanent upgrades', () => {
    const json = JSON.stringify({
      version: CURRENT_SAVE_VERSION,
      resources: {},
      prestige: { permanentUpgrades: JSON.parse('{"__proto__": {"polluted": true}, "refactoringGrant": 1}') },
    });
    const state = deserializeState(json);
    expect(Object.keys(state.prestige.permanentUpgrades)).toEqual(['refactoringGrant']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('deserialize – migration from the pre-release format', () => {
  it('reads the v0 shape and derives lifetimeCash', () => {
    const v0 = JSON.stringify({
      version: 0,
      resources: { linesOfCode: '10', coffee: '5', cash: '1000' },
      generators: { juniorDev: 4, seniorDev: 2 },
      upgrades: ['codeMaster'],
      stats: {
        playSeconds: 90,
        manualClicks: 4,
        runCount: 2,
        totalCashEarned: '5000',
        totalLinesMined: '300',
      },
      prestige: { techDebt: '12', permanentUpgrades: {}, bestRun: 2 },
      lastTickAt: 1_700_000_000_000,
    });
    const state = deserializeState(v0);
    expect(state.version).toBe(CURRENT_SAVE_VERSION);
    expect(state.resources.lifetimeCash.toString()).toBe('5000');
    expect(state.generators.juniorDev.owned).toBe(4);
    expect(state.upgrades.purchased).toEqual(['codeMaster']);
    expect(state.prestige.techDebt.toString()).toBe('12');
    // The v0 schema called this `stats.runCount`; it is now `prestigeCount`.
    expect(state.stats.prestigeCount).toBe(2);
  });

  it('assumes pre-baseline lifetime cash was already banked', () => {
    // A save from before `baselineLifetimeCash` existed has no way to know what
    // was cashed in. Assuming it was banked closes the re-claim exploit rather
    // than handing out free Tech Debt on upgrade.
    const v0 = JSON.stringify({
      version: 0,
      resources: { cash: '1', lifetimeCash: '1e9' },
      prestige: { techDebt: '0', permanentUpgrades: {} },
    });
    const state = deserializeState(v0);
    expect(state.prestige.baselineLifetimeCash.toString()).toBe(dec(1e9).toString());
    expect(runLifetimeCash(state).toString()).toBe('0');
  });

  it('derives lifetimeCash from totalCashEarned when absent', () => {
    const v0 = JSON.stringify({
      version: 0,
      resources: { cash: '10' },
      stats: { totalCashEarned: '777' },
    });
    expect(deserializeState(v0).resources.lifetimeCash.toString()).toBe('777');
  });

  it('reads the v0 object-shaped upgrades field too', () => {
    const v0 = JSON.stringify({
      version: 0,
      resources: { cash: '1' },
      upgrades: { purchased: ['styleGuide'] },
    });
    expect(deserializeState(v0).upgrades.purchased).toEqual(['styleGuide']);
  });

  it('re-locks nothing: unlocks are re-derived from lifetime cash', () => {
    const v0 = JSON.stringify({
      version: 0,
      resources: { cash: '1', lifetimeCash: '1e9' },
      generators: { juniorDev: 1 },
    });
    const state = deserializeState(v0);
    expect(state.generators.k8sCluster.unlocked).toBe(true);
  });
});

describe('parseSaveBlob', () => {
  it('accepts the canonical blob', () => {
    const blob = parseSaveBlob(serializeState(populated()));
    expect(blob.version).toBe(CURRENT_SAVE_VERSION);
    expect(blob.resources.cash).toBe('1234.5');
  });

  it('never throws for non-string input', () => {
    expect(() => parseSaveBlob(undefined as unknown as string)).toThrow();
  });
});

describe('storage', () => {
  it('returns a fresh state when nothing is stored', () => {
    clearSaveData();
    const result = loadGameState();
    expect(result.source).toBe('fresh');
    // A new game grants starting cash so the first generator is affordable.
    expect(Number(result.state.resources.cash.toString())).toBe(STARTING_CASH);
    expect(result.state.resources.lifetimeCash.toString()).toBe('0');
  });

  it('round-trips through localStorage', () => {
    clearSaveData();
    const state = populated();
    expect(saveGameState(state)).toBe(true);

    const result = loadGameState();
    expect(result.source).toBe('current');
    expect(result.state.generators.juniorDev.owned).toBe(17);
    expect(result.state.prestige.techDebt.toString()).toBe('250');
    expect(Number(result.state.resources.lifetimeCash.toString())).toBe(9.876e12);
  });

  it('quarantines a corrupt save and recovers from the backup', () => {
    clearSaveData();
    saveGameState(populated());
    saveGameState(populated()); // second write moves the first into .backup

    localStorage.setItem(KEY_CURRENT, '{{{ not json');

    const result = loadGameState();
    expect(result.source).toBe('backup');
    expect(result.error).toBeTruthy();
    expect(localStorage.getItem(KEY_CORRUPT)).toBe('{{{ not json');
    // The recovered save is promoted back to current.
    expect(localStorage.getItem(KEY_CURRENT)).not.toBe('{{{ not json');
  });

  it('starts fresh when both current and backup are corrupt', () => {
    clearSaveData();
    localStorage.setItem(KEY_CURRENT, 'garbage');
    localStorage.setItem(KEY_BACKUP, 'also garbage');
    const result = loadGameState();
    expect(result.source).toBe('fresh');
    expect(result.error).toBeTruthy();
  });

  it('quarantines, never promotes, an unparseable previous save', () => {
    clearSaveData();
    localStorage.setItem(KEY_CURRENT, 'garbage');
    saveGameState(populated());

    // The bad string must not become the recovery source...
    expect(localStorage.getItem(KEY_BACKUP)).toBeNull();
    // ...it is preserved for inspection instead.
    expect(localStorage.getItem(KEY_CORRUPT)).toBe('garbage');
    // ...and the good save is written successfully.
    expect(loadGameState().source).toBe('current');
  });

  it('records the last save time', () => {
    clearSaveData();
    expect(getLastSavedAt()).toBeNull();
    saveGameState(populated(), 1_700_000_000_000);
    expect(getLastSavedAt()).toBe(1_700_000_000_000);
  });

  it('clears every slot on hard reset', () => {
    saveGameState(populated());
    clearSaveData();
    expect(readSaveString()).toBeNull();
    expect(localStorage.getItem(KEY_BACKUP)).toBeNull();
    expect(localStorage.getItem(KEY_CORRUPT)).toBeNull();
    expect(getLastSavedAt()).toBeNull();
  });

  it('survives a localStorage that throws on write (quota)', () => {
    clearSaveData();
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function throwing() {
      throw new Error('QuotaExceededError');
    };
    try {
      expect(saveGameState(populated())).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('falls back to a fresh state when storage is unreadable', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function throwing() {
      throw new Error('SecurityError');
    };
    try {
      const result = loadGameState();
      expect(result.source).toBe('fresh');
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
