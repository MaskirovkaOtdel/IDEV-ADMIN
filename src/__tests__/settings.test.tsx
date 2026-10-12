/**
 * Settings — the module, and the surface that exposes it.
 *
 * WHY THIS MODULE IS SHAPED THE WAY IT IS
 * ---------------------------------------
 * Two properties are load-bearing and both are structural rather than
 * conventional:
 *
 *   1. It does not import the store. That is what makes a setting incapable of
 *      changing a number the player earns. The debug panel calls `grantResources`
 *      and mints money; the distinction between "preferences" and "cheats" is
 *      normally a review rule, and review rules erode one option at a time. This
 *      one is enforced by the absence of an import path.
 *
 *   2. It is not in the save blob. Settings are device preferences. Putting them
 *      in the save would mean importing a save silently changed somebody's
 *      accessibility settings, and would force a CURRENT_SAVE_VERSION bump --
 *      making a cosmetic feature a minor release.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, act, cleanup, screen, within } from '@testing-library/react';
import App from '../App';
import {
  DEFAULT_SETTINGS,
  KEY_SETTINGS,
  motionAllowed,
  parseSettings,
  resetSettings,
  settingsSnapshot,
  updateSettings,
  __resetSettingsForTest,
} from '../game/settings';
import { useGameStore } from '../game/gameStore';
import { clearSaveData, saveGameState } from '../game/storage';
import { createInitialState } from '../game/serialize';
import { dec } from '../game/decimal';

const appSrc = resolve(import.meta.dirname, '..');

/** Remove comments so prose about a rule cannot fail the rule's own assertion. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

beforeEach(() => {
  clearSaveData();
  localStorage.removeItem(KEY_SETTINGS);
  __resetSettingsForTest();
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(KEY_SETTINGS);
  __resetSettingsForTest();
});

describe('settings cannot affect game state', () => {
  it('has no import path to the store', () => {
    // Read from source rather than trusting review. The moment somebody adds
    // `grantResources` here, this fails and they have to justify it.
    //
    // Comments are stripped first: this file *documents* the rule by naming the
    // functions it must not call, and a naive substring check fails on its own
    // explanation. The assertion is about code.
    const source = stripComments(
      readFileSync(resolve(appSrc, 'game', 'settings.ts'), 'utf8')
    );
    const imports = [...source.matchAll(/^import .*?from '([^']+)'/gm)].map((m) => m[1]);
    expect(imports, 'settings must not import the game store').not.toContain('./gameStore');
    expect(source).not.toMatch(/\bgrantResources\b|\bbuyGenerator\b|\bhardReset\b|\bperformPrestige\b/);
  });

  it('is not part of the save blob', () => {
    // Otherwise importing a save would carry somebody else's preferences with it,
    // and this cosmetic feature would become a schema change.
    //
    // `SaveBlob` lives in types.ts, not serialize.ts. The first version of this
    // assertion read serialize.ts, found nothing there, and passed without
    // checking anything at all -- a test that cannot fail.
    const blob = readFileSync(resolve(appSrc, 'game', 'types.ts'), 'utf8');
    const match = /export interface SaveBlob \{([\s\S]*?)\n\}/.exec(blob);
    expect(match, 'SaveBlob interface not found').toBeTruthy();
    expect(match![1]).not.toMatch(/autosaveSeconds|confirmPrestige|\bmotion\b/);
  });
});

describe('parseSettings treats stored data as hostile', () => {
  it('falls back on a non-object', () => {
    for (const junk of [null, undefined, 42, 'nope', [], true]) {
      expect(parseSettings(junk)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('rejects an unknown motion preference', () => {
    expect(parseSettings({ motion: 'sideways' }).motion).toBe('system');
  });

  it('keeps the three real motion preferences', () => {
    for (const motion of ['system', 'always', 'never'] as const) {
      expect(parseSettings({ motion }).motion).toBe(motion);
    }
  });

  it('clamps a nonsense autosave interval rather than propagating it', () => {
    // localStorage is user-writable and survives versions. An unvalidated value
    // would reach setInterval.
    expect(parseSettings({ autosaveSeconds: -5 }).autosaveSeconds).toBe(1);
    expect(parseSettings({ autosaveSeconds: 1e9 }).autosaveSeconds).toBe(600);
    expect(parseSettings({ autosaveSeconds: 'soon' }).autosaveSeconds).toBe(
      DEFAULT_SETTINGS.autosaveSeconds
    );
    expect(Number.isFinite(parseSettings({ autosaveSeconds: NaN }).autosaveSeconds)).toBe(true);
  });

  it('coerces a non-boolean confirm flag back to the default', () => {
    expect(parseSettings({ confirmPrestige: 'yes' }).confirmPrestige).toBe(
      DEFAULT_SETTINGS.confirmPrestige
    );
  });
});

describe('settings persist and reset', () => {
  it('round-trips through storage', () => {
    updateSettings({ autosaveSeconds: 30 });
    const stored = JSON.parse(localStorage.getItem(KEY_SETTINGS)!);
    expect(stored.autosaveSeconds).toBe(30);
    expect(settingsSnapshot().autosaveSeconds).toBe(30);
  });

  it('reset restores the defaults without touching the save', () => {
    updateSettings({ autosaveSeconds: 60, confirmPrestige: false, motion: 'never' });
    resetSettings();
    expect(settingsSnapshot()).toEqual(DEFAULT_SETTINGS);
    // The save is a different key entirely, so it cannot have been touched.
    expect(localStorage.getItem('idev-admin:save')).toBeNull();
  });

  it('survives corrupt stored JSON rather than throwing on boot', () => {
    localStorage.setItem(KEY_SETTINGS, '{not json');
    expect(() => __resetSettingsForTest()).not.toThrow();
    expect(settingsSnapshot()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('motionAllowed is a pure function of its inputs', () => {
  it('defer to the system by default', () => {
    expect(motionAllowed('', true)).toBe(false);
    expect(motionAllowed('', false)).toBe(true);
  });

  it('honour an explicit preference over the system', () => {
    expect(motionAllowed('', true, 'always')).toBe(true);
    expect(motionAllowed('', false, 'never')).toBe(false);
  });

  it('let the URL override everything, so a link is shareable', () => {
    expect(motionAllowed('?motion=force', true, 'never')).toBe(true);
    expect(motionAllowed('?motion=off', false, 'always')).toBe(false);
  });
});

describe('the settings surface', () => {
  async function mount(settleMs = 250) {
    render(<App />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    });
  }

  const openSettings = async () => {
    await act(async () => {
      screen.getByRole('button', { name: /settings/i }).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  };

  it('is reachable from a labelled control in the sidebar', async () => {
    await mount();
    // Not a fourth nav tab: the three tabs are the game loop, and a tab called
    // "Settings" reads as somewhere else to buy things.
    expect(screen.getByRole('button', { name: /settings/i })).toBeTruthy();
  });

  it('opens a dialog and is a real one', async () => {
    await mount();
    await openSettings();

    const dialog = document.querySelector('.modal-window');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });

  it('closes on Escape', async () => {
    await mount();
    await openSettings();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('.modal-window')).toBeNull();
  });

  it('reaches save export/import, which used to be buried in the Prestige panel', async () => {
    // The reason this surface exists: SaveManager was reachable only from a ghost
    // button at the bottom of the least-visited tab, so the only way to move a
    // save between devices was effectively hidden.
    await mount();
    await openSettings();

    await act(async () => {
      screen.getByRole('button', { name: /export \/ import/i }).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByRole('heading', { name: /save data/i })).toBeTruthy();
  });

  it('changing a preference persists it and takes effect immediately', async () => {
    await mount();
    await openSettings();

    const thirtySeconds = screen.getByRole('radio', { name: '30s' });
    await act(async () => {
      thirtySeconds.click();
    });

    expect(settingsSnapshot().autosaveSeconds).toBe(30);
    expect(JSON.parse(localStorage.getItem(KEY_SETTINGS)!).autosaveSeconds).toBe(30);
  });

  it('changing the notation re-spells the numbers the player can see', async () => {
    // The point of the setting is the rendered digits, so the test has to read the
    // rendered digits. Asserting only that `settings.notation` flipped would pass
    // with the preference wired to nothing at all, which is the exact defect the
    // autosave test two lines below documents.
    await mount();

    // Grant AFTER mount: App hydrates on load, which replaces gameState wholesale,
    // so a seed written before mount is silently discarded. That is a real trap --
    // the first version of this test set `cash` (which is not a field) before
    // mounting and asserted on an empty screen, passing for the wrong reason until
    // it was rewritten to read `resources.cash` and grant post-hydrate.
    await act(async () => {
      useGameStore.getState().grantResources('cash', dec(3.79e9));
    });
    await openSettings();

    // Whatever the current spelling is, find the node carrying the cash figure.
    const cashNode = () =>
      document.querySelector('.resource-value')?.textContent ?? '(not rendered)';

    expect(cashNode(), 'baseline cash should read as a suffix').toBe('3.79B');

    const standard = screen.getByRole('radio', { name: 'Standard' });
    await act(async () => {
      standard.click();
    });

    expect(settingsSnapshot().notation).toBe('standard');
    expect(cashNode(), 'after choosing Standard').toBe('3.79e9');

    // And it survives a reload, which is what makes it a setting rather than a toggle.
    expect(JSON.parse(localStorage.getItem(KEY_SETTINGS)!).notation).toBe('standard');
  });

  it('actually re-times the autosave, rather than being a decorative toggle', async () => {
    // A preference that is stored but never read is the worst outcome: it looks
    // like it works. The first version of this test only checked the value was
    // persisted, and passed with `useAutosave()` called with no argument at all.
    updateSettings({ autosaveSeconds: 30 });

    const setInterval = vi.spyOn(globalThis, 'setInterval');
    try {
      await mount();
      const intervals = setInterval.mock.calls.map((c) => c[1]);
      expect(
        intervals,
        `no 30000ms interval was scheduled; saw ${JSON.stringify(intervals)}`
      ).toContain(30_000);
    } finally {
      setInterval.mockRestore();
    }
  });

  it('Reset preferences restores defaults and leaves the save alone', async () => {
    // Wiping a player's progress from a button labelled "Reset preferences" would
    // be unforgivable. Seeded with real progress so the assertion can tell.
    useGameStore.getState().hardReset();
    const saved = createInitialState();
    saved.resources.lifetimeCash = dec(777_777);
    saved.generators.juniorDev = { owned: 33, unlocked: true };
    saveGameState(saved);

    updateSettings({ autosaveSeconds: 60, confirmPrestige: false, motion: 'never' });

    await mount();
    await openSettings();

    await act(async () => {
      screen.getByRole('button', { name: /^reset$/i }).click();
    });

    expect(settingsSnapshot()).toEqual(DEFAULT_SETTINGS);

    // Asserted on the LIVE store, not on localStorage. `hardReset` clears storage
    // and rewrites in-memory state immediately, but does not save synchronously --
    // so reading storage straight after the click sees the *old* save and the
    // assertion passed even with the destructive call wired in.
    const state = useGameStore.getState().gameState;
    expect(state.generators.juniorDev.owned, 'generators were wiped').toBe(33);
    expect(Number(state.resources.lifetimeCash.toString())).toBeGreaterThan(700_000);

    // And once the autosave does land, the written save must still hold it.
    await act(async () => {
      useGameStore.getState().save();
    });
    const blob = JSON.parse(localStorage.getItem('idev-admin:save')!);
    expect(blob.generators.juniorDev).toBe(33);
  });

  it('marks the active choice for assistive tech', async () => {
    await mount();
    await openSettings();

    // Exactly one checked radio PER GROUP. A bare count cannot tell "one in each
    // of three groups" from "all three in one group and none in the others", and
    // that distinction is the whole point of a radiogroup -- an unchecked group
    // reads to a screen reader as "you have not chosen yet", which is a lie.
    const groups = screen.getAllByRole('radiogroup');
    expect(groups.length).toBeGreaterThanOrEqual(3);

    for (const group of groups) {
      const radios = within(group).getAllByRole('radio');
      const checked = radios.filter((r) => r.getAttribute('aria-checked') === 'true');
      const name = group.getAttribute('aria-label') ?? '(unlabelled group)';
      expect(checked, `"${name}" has ${checked.length} checked, expected exactly 1`)
        .toHaveLength(1);
    }
  });

  it('every control is labelled', async () => {
    await mount();
    await openSettings();

    for (const radio of screen.getAllByRole('radio')) {
      const name = radio.getAttribute('aria-label') ?? radio.textContent ?? '';
      expect(name.trim(), 'an unlabelled radio in settings').not.toBe('');
    }
    for (const toggle of screen.getAllByRole('checkbox')) {
      // A bare checkbox inside a <label> wrapping the text is labelled by
      // association; assert the label actually exists.
      expect(toggle.closest('label'), 'checkbox outside a label').toBeTruthy();
    }
  });

  it('does not disturb the Prestige confirmation by default', async () => {
    // The default must stay on. Silently skipping a destructive-action prompt
    // would be the worst possible default for a settings menu.
    await seedPrestigeable();
    await mount();
    await clickPrestigeTab();
    await act(async () => {
      resetRunButton().click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(document.querySelector('[aria-labelledby="confirm-reset-title"]')).toBeTruthy();
    // Nothing happened yet.
    expect(useGameStore.getState().gameState.stats.prestigeCount).toBe(0);
  });

  it('skips the confirmation when the player has turned it off', async () => {
    updateSettings({ confirmPrestige: false });
    await seedPrestigeable();
    await mount();
    await clickPrestigeTab();
    await act(async () => {
      resetRunButton().click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(document.querySelector('[aria-labelledby="confirm-reset-title"]')).toBeNull();
    // And the reset actually happened, rather than silently doing nothing.
    expect(useGameStore.getState().gameState.stats.prestigeCount).toBeGreaterThan(0);
  });
});

/** A save with enough lifetime cash that a reset is worth taking. */
async function seedPrestigeable() {
  useGameStore.getState().hardReset();
  const saved = createInitialState();
  saved.resources.cash = dec(1_000_000);
  saved.resources.lifetimeCash = dec(5_000_000);
  saved.generators.juniorDev = { owned: 50, unlocked: true };
  saveGameState(saved);
}

const resetRunButton = () =>
  screen.getByRole('button', { name: /reset run for/i }) as HTMLButtonElement;

async function clickPrestigeTab() {
  await act(async () => {
    screen.getByRole('button', { name: /prestige/i }).click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}
