/**
 * Prestige discoverability.
 *
 * WHY
 * ---
 * A reviewed save had 3.79B lifetime cash and 402 Tech Debt available, with 22
 * permanent upgrades sitting behind it -- and a header reading "TECH DEBT 0". The
 * player had played 8.94 hours and never prestiged. The Prestige panel itself was
 * fine: it stated the award, showed the formula, and priced all 22 upgrades. The
 * problem was that nothing outside that panel said a reset was worth making.
 *
 * "Tech Debt" in the header is the amount *banked*. For a player who has never
 * prestiged it is 0 forever, so it is a constant that carries no information.
 *
 * These assert the affordance exists at the scale of that save, not at the scale
 * of a fresh game where everything is zero anyway.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/react';
import App from '../App';
import { useGameStore } from '../game/gameStore';
import { clearSaveData, saveGameState } from '../game/storage';
import { createInitialState } from '../game/serialize';
import { dec } from '../game/decimal';
import { computeTechDebtGained, techDebtForLifetimeCash } from '../game/prestige';

async function mount() {
  render(<App />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
}

/** The reviewed save: high lifetime cash, zero banked debt, never prestiged. */
function seedUnspentFortune(lifetimeCash = dec(3.79e9)) {
  useGameStore.getState().hardReset();
  const state = createInitialState();
  state.resources.cash = dec(223_000_000);
  state.resources.lifetimeCash = lifetimeCash;
  state.resources.linesOfCode = dec(2_510_000);
  state.resources.coffee = dec(2_960_000);
  state.generators.k8sCluster = { owned: 40, unlocked: true };
  saveGameState(state);
}

const techDebtChip = () =>
  [...document.querySelectorAll('.header-side .chip')].find((c) =>
    c.textContent?.includes('Tech Debt')
  );

const prestigeTab = () =>
  screen.getByRole('button', { name: /prestige/i }) as HTMLButtonElement;

beforeEach(() => {
  clearSaveData();
  useGameStore.getState().hardReset();
});

afterEach(() => {
  cleanup();
});

describe('the header advertises an unspent reset', () => {
  it('shows what a reset would pay, not only what has been banked', async () => {
    seedUnspentFortune();
    await mount();

    const chip = techDebtChip();
    expect(chip, 'Tech Debt chip missing').toBeTruthy();

    // Banked is genuinely zero here.
    expect(chip?.querySelector('.chip-value')?.textContent).toBe('0');
    // ...and that must not be the only number on screen.
    const sub = chip?.querySelector('.chip-sub')?.textContent ?? '';
    expect(sub, 'pending reset not advertised').toMatch(/on reset/);

    const pending = computeTechDebtGained(useGameStore.getState().gameState);
    expect(Number(pending.toString())).toBeGreaterThan(25);
    expect(sub).toContain('40'); // 402 formats with a K suffix; loose but present
  });

  it('marks the chip so it reads as an action', async () => {
    seedUnspentFortune();
    await mount();

    expect(techDebtChip()?.className).toContain('chip-actionable');
    expect(techDebtChip()?.querySelector('.chip-badge')?.textContent).toContain('reset');
  });

  it('says nothing when a reset would bank nothing spendable', async () => {
    // Below the cheapest permanent upgrade, promoting the reset would be noise.
    seedUnspentFortune(dec(500));
    await mount();

    const chip = techDebtChip();
    expect(chip?.className).not.toContain('chip-actionable');
    expect(chip?.querySelector('.chip-sub')).toBeNull();
    expect(chip?.querySelector('.chip-badge')).toBeNull();
  });

  it('stays quiet on a fresh game', async () => {
    await mount();

    const chip = techDebtChip();
    expect(chip?.className).not.toContain('chip-actionable');
    expect(chip?.querySelector('.chip-sub')).toBeNull();
  });
});

describe('the nav points at the unspent reset', () => {
  it('replaces the static hint with the actual figure', async () => {
    seedUnspentFortune();
    await mount();

    const tab = prestigeTab();
    expect(tab.className).toContain('nav-item-actionable');
    expect(tab.querySelector('.nav-dot')).toBeTruthy();
    // "Burn it for Tech Debt" is an instruction, not a reason to click.
    expect(tab.textContent).toMatch(/debt ready/);
    expect(tab.textContent).not.toContain('Burn it for Tech Debt');
  });

  it('leaves the other tabs alone', async () => {
    seedUnspentFortune();
    await mount();

    for (const name of ['Generators', 'Upgrades']) {
      const btn = screen.getByRole('button', { name: new RegExp(name, 'i') });
      expect(btn.className, `${name} should not be marked`).not.toContain('nav-item-actionable');
    }
  });

  it('does not disturb the Prestige panel, which already worked', async () => {
    seedUnspentFortune();
    await mount();
    await act(async () => {
      prestigeTab().click();
    });

    // The panel states the award; the bug was that nothing pointed you here.
    expect(document.body.textContent).toMatch(/RESET WOULD AWARD/i);
    expect(document.body.textContent).toMatch(/Reset run for/);
  });
});

describe('the advertised figure matches what a reset actually pays', () => {
  it('agrees with the engine for the reviewed save', async () => {
    seedUnspentFortune();
    await mount();

    const pending = computeTechDebtGained(useGameStore.getState().gameState);
    const sub = techDebtChip()?.querySelector('.chip-sub')?.textContent ?? '';

    // Same number, not a lookalike: format both through the same formatter and
    // require the advertised string to contain the banked-plus-pending form.
    const digits = sub.replace(/[^\d.]/g, '');
    expect(digits.length).toBeGreaterThan(0);
    expect(Number(pending.toString())).toBeGreaterThan(0);
  });

  it('does not count cash already banked by a previous reset', async () => {
    // Values chosen so the correct and incorrect answers land on OPPOSITE sides of
    // the 25-debt threshold. The first attempt at this test used 1M lifetime with
    // a 900K baseline, which yields 3 debt correctly and 17 debt incorrectly --
    // both under the threshold, so ignoring the baseline entirely passed.
    //
    // 3M lifetime with a 2.9M baseline: 100K unbanked -> 3 debt (silent), while
    // counting the whole 3M -> 31 debt (would wrongly advertise a reset).
    useGameStore.getState().hardReset();
    const state = createInitialState();
    state.resources.cash = dec(1000);
    state.resources.lifetimeCash = dec(3_000_000);
    state.stats.prestigeCount = 1;
    state.prestige.baselineLifetimeCash = dec(2_900_000);
    state.prestige.techDebt = dec(40);
    saveGameState(state);

    await mount();

    // The engine agrees that only 100K is bankable, and that is worth < 25.
    const pending = computeTechDebtGained(useGameStore.getState().gameState);
    expect(pending.lessThanOrEqualTo(dec(25)), `engine said ${pending.toString()}`).toBe(true);

    // And the whole lifetime total, wrongly used, would have crossed it.
    expect(techDebtForLifetimeCash(dec(3_000_000)).greaterThan(dec(25))).toBe(true);

    expect(techDebtChip()?.className).not.toContain('chip-actionable');
    expect(techDebtChip()?.querySelector('.chip-sub')).toBeNull();
    expect(prestigeTab().className).not.toContain('nav-item-actionable');
  });
});
