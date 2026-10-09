/**
 * The Upgrades panel when there is nothing to buy.
 *
 * WHY
 * ---
 * A reviewed save owned 12/12 run upgrades, and the panel then read "Nothing to buy
 * here right now" in a screen-height void for the rest of a nine-hour session. In a
 * game whose whole appeal is deciding what to work towards next, that is the panel
 * telling the player there is no next.
 *
 * The fix is to show the nearest few LOCKED upgrades with their unlock condition,
 * reusing `meetsUpgradeRequirements` for the copy so the reason can never disagree
 * with the rule that gates it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/react';
import App from '../App';
import { useGameStore } from '../game/gameStore';
import { clearSaveData, saveGameState } from '../game/storage';
import { createInitialState } from '../game/serialize';
import { dec } from '../game/decimal';
import { UPGRADE_DEFS } from '../game/upgrades';
import { LOCKED_PREVIEW_COUNT } from '../components/UpgradeGrid';

async function mount(settleMs = 250) {
  render(<App />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  });
}

async function openUpgrades() {
  await act(async () => {
    screen.getByRole('button', { name: /upgrades/i }).click();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/**
 * Nothing affordable, nothing bought.
 *
 * This is the state that produced "Nothing to buy here right now": upgrades
 * remain, but none of them can be paid for. Note that owning EVERY upgrade is a
 * different case and is handled separately below.
 */
function seedNothingAffordable() {
  useGameStore.getState().hardReset();
  const state = createInitialState();
  // Zeroed after createInitialState, which grants starting cash and unlocks
  // Junior Dev -- both of which make something purchasable.
  state.resources.cash = dec(0);
  state.resources.linesOfCode = dec(0);
  state.resources.coffee = dec(0);
  state.resources.lifetimeCash = dec(0);
  state.generators.juniorDev = { owned: 0, unlocked: true };
  state.upgrades.purchased = [];
  saveGameState(state);
}

/** Own every upgrade: the genuinely-finished case. */
function seedEverythingBought() {
  useGameStore.getState().hardReset();
  const state = createInitialState();
  state.resources.cash = dec(0);
  state.resources.linesOfCode = dec(0);
  state.resources.coffee = dec(0);
  state.resources.lifetimeCash = dec(0);
  state.upgrades.purchased = UPGRADE_DEFS.map((d) => d.id);
  saveGameState(state);
}

beforeEach(() => {
  clearSaveData();
  useGameStore.getState().hardReset();
});

afterEach(() => {
  cleanup();
  clearSaveData();
});

describe('the panel never goes blank', () => {
  it('still lists every unbought upgrade when none is affordable', async () => {
    // With the filter off this branch was never blank to begin with -- it showed
    // all 27. An early version of these tests asserted a 3-row preview here and
    // failed, because the preview only fires when the visible list is empty.
    seedNothingAffordable();
    await mount();
    await openUpgrades();

    expect(document.querySelectorAll('.upgrade-card').length).toBe(UPGRADE_DEFS.length);
    expect(screen.queryByText(/nothing to buy here right now/i)).toBeNull();
  });

  it('shows normal cards while upgrades remain and something is affordable', async () => {
    await mount();
    await openUpgrades();

    expect(document.querySelectorAll('.upgrade-preview').length).toBe(0);
    expect(document.querySelectorAll('.upgrade-card').length).toBeGreaterThan(0);
  });

  it('points at prestige when every upgrade is genuinely bought', async () => {
    // The case that actually shipped broken: 12/12 owned, and the panel shrugged.
    // There is no next upgrade, so the honest next step is the permanent tree --
    // which the old copy never mentioned.
    seedEverythingBought();
    await mount();
    await openUpgrades();

    expect(document.querySelectorAll('.upgrade-preview').length).toBe(0);
    expect(document.body.textContent).toMatch(/every upgrade is yours/i);
    expect(document.body.textContent).toMatch(/Tech Debt/i);
  });
});

describe('the affordable-only filter previews what to save for', () => {
  async function enableFilter() {
    await act(async () => {
      screen.getByRole('checkbox', { name: /affordable only/i }).click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }

  it('shows the nearest locked upgrades rather than nothing', async () => {
    // This is the branch the preview exists for: the filter is a direct question
    // -- "what can I buy?" -- and "nothing" is a dead end.
    seedNothingAffordable();
    await mount();
    await openUpgrades();
    await enableFilter();

    expect(document.querySelectorAll('.upgrade-preview').length).toBe(
      LOCKED_PREVIEW_COUNT
    );
    expect(screen.queryByText(/nothing to buy here right now/i)).toBeNull();
  });

  it('says why each previewed upgrade is locked', async () => {
    seedNothingAffordable();
    await mount();
    await openUpgrades();
    await enableFilter();

    const reasons = [...document.querySelectorAll('.upgrade-locked-reason')].map((el) =>
      el.textContent?.trim() ?? ''
    );
    expect(reasons).toHaveLength(LOCKED_PREVIEW_COUNT);
    for (const reason of reasons) {
      expect(reason.length, 'a locked upgrade with no reason shown').toBeGreaterThan(0);
    }
    // Copy comes from meetsUpgradeRequirements, so it names the specific gate.
    expect(reasons.join(' ')).toMatch(/Requires|Needs/);
  });

  it('previews exactly three, not the whole tree', async () => {
    // Twenty-seven greyed rows would be worse than the void: it reads as a wall.
    seedNothingAffordable();
    await mount();
    await openUpgrades();
    await enableFilter();

    expect(document.querySelectorAll('.upgrade-preview').length).toBe(LOCKED_PREVIEW_COUNT);
    expect(UPGRADE_DEFS.length).toBeGreaterThan(LOCKED_PREVIEW_COUNT);
  });

  it('shows only affordable cards while some are affordable', async () => {
    // A fresh game grants 25 starting cash and the cheapest upgrade costs 50, so
    // "nothing is affordable" is the fresh state -- which is why this needs seeding
    // rather than just mounting. An earlier version of this test used a fresh game
    // and correctly failed: the preview branch is the right answer there.
    useGameStore.getState().hardReset();
    const state = createInitialState();
    state.resources.cash = dec(60_000);
    saveGameState(state);

    await mount();
    await openUpgrades();
    await enableFilter();

    expect(document.querySelectorAll('.upgrade-preview').length).toBe(0);
    expect(document.querySelectorAll('.upgrade-card').length).toBeGreaterThan(0);
  });
});
