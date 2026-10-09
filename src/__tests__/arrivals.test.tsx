/**
 * Arrival animation from offline progress.
 *
 * WHY THESE EXIST
 * ---------------
 * v0.4.0 shipped an arrival animation that worked only if you were actively
 * playing. Generators unlocked by the *offline* walk produced no animation at
 * all, because by the time any component mounted they were already unlocked and
 * the panel's live diff could not tell them apart from a restored save. The
 * first-pass guard added to stop restored saves spamming animations therefore
 * suppressed exactly the case the animation was built for: a player returning
 * after sixteen hours away.
 *
 * Reported as "I see some subtle animations but nothing much", on a return visit
 * with two generators unlocked while away.
 *
 * The store now records which generators the offline walk unlocked, because that
 * is the only place the before and after states coexist.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import App from '../App';
import { useGameStore } from '../game/gameStore';
import { clearSaveData, KEY_CURRENT, saveGameState } from '../game/storage';
import { createInitialState } from '../game/serialize';
import { dec } from '../game/decimal';
import { MIN_OFFLINE_SECONDS_FOR_REPORT } from '../game/offline';
import { GENERATOR_DEFS } from '../game/generators';
import type { GeneratorId } from '../game/types';

const HOUR_MS = 60 * 60 * 1000;

async function mount() {
  await act(async () => {
    render(<App />);
  });
}

const arrivalCards = () =>
  [...document.querySelectorAll('.generator-card.just-unlocked')].map((c) =>
    c.querySelector('.card-title')?.textContent
  );

/** Push the stored save's timestamps into the past. */
function rewindSave(elapsedMs: number) {
  const raw = localStorage.getItem(KEY_CURRENT);
  expect(raw).toBeTruthy();

  // BOTH keys matter, and missing the second one silently produced a zero-length
  // absence -- the tests failed with "expected [] to equal ['seniorDev']" and no
  // clue why. The blob carries `savedAt` *and* `lastTickAt`, and
  // `deserializeState` prefers `lastTickAt`, so rewinding only `savedAt` leaves
  // the state looking like it was written a millisecond ago.
  const parsed = JSON.parse(raw!) as { savedAt: number; lastTickAt: number };
  expect(typeof parsed.savedAt, 'save blob should carry savedAt').toBe('number');
  expect(typeof parsed.lastTickAt, 'save blob should carry lastTickAt').toBe('number');
  parsed.savedAt -= elapsedMs;
  parsed.lastTickAt -= elapsedMs;
  localStorage.setItem(KEY_CURRENT, JSON.stringify(parsed));
}

/**
 * A save whose offline walk crosses exactly the seniorDev threshold.
 *
 * Sized so one arrival is unambiguous: one Junior Dev at 0.2/s over an hour at
 * 50% efficiency earns 360, taking lifetime cash from 200 to 560. That clears
 * seniorDev (400) but not codeReview (2500).
 *
 * Order matters twice over. `hardReset` clears storage, so it runs FIRST; writing
 * the save after it would be undone. And `createInitialState` grants starting
 * cash, which is zeroed here so the walk's earnings are the only contribution.
 */
function seedArrivalSave(elapsedMs = HOUR_MS) {
  useGameStore.getState().hardReset();

  const saved = createInitialState();
  saved.resources.cash = dec(0);
  saved.resources.lifetimeCash = dec(200);
  saved.generators.juniorDev = { owned: 1, unlocked: true };
  saveGameState(saved);
  rewindSave(elapsedMs);
}

/** A save with everything already unlocked: nothing should ever arrive. */
function seedSettledSave() {
  useGameStore.getState().hardReset();

  const saved = createInitialState();
  saved.resources.lifetimeCash = dec(1_000_000);
  for (const def of GENERATOR_DEFS) {
    saved.generators[def.id as GeneratorId] = { owned: 5, unlocked: true };
  }
  saveGameState(saved);
  rewindSave(8 * HOUR_MS);
}

describe('offline arrivals are recorded', () => {
  beforeEach(() => {
    clearSaveData();
    useGameStore.getState().hardReset();
  });

  it('records generators unlocked during a long absence', () => {
    // Sized so exactly one threshold is crossed: one Junior Dev at 0.2/s over an
    // hour at 50% efficiency earns 360, taking lifetime cash from 200 to 560.
    // That clears seniorDev (400) but not codeReview (2500), so the expected list
    // is unambiguous.
    seedArrivalSave();

    act(() => {
      useGameStore.getState().hydrate();
    });

    expect(useGameStore.getState().pendingArrivals).toEqual(['seniorDev']);
  });

  it('records nothing for a brief absence', () => {
    useGameStore.getState().hardReset();

    const saved = createInitialState();
    saved.resources.lifetimeCash = dec(200);
    saved.generators.juniorDev = { owned: 1, unlocked: true };
    saveGameState(saved);
    rewindSave(MIN_OFFLINE_SECONDS_FOR_REPORT * 1000 - 2000);

    act(() => {
      useGameStore.getState().hydrate();
    });

    expect(useGameStore.getState().pendingArrivals).toEqual([]);
  });

  it('records nothing when the save already had everything unlocked', () => {
    // An old save where nothing is left to unlock: the player was away a long
    // time, but no threshold was crossed, so there is nothing to announce.
    seedSettledSave();

    act(() => {
      useGameStore.getState().hydrate();
    });

    expect(useGameStore.getState().pendingArrivals).toEqual([]);
  });

  it('clears on demand so a reload does not replay them', () => {
    seedArrivalSave();

    act(() => {
      useGameStore.getState().hydrate();
    });
    expect(useGameStore.getState().pendingArrivals.length).toBeGreaterThan(0);

    act(() => {
      useGameStore.getState().clearPendingArrivals();
    });
    expect(useGameStore.getState().pendingArrivals).toEqual([]);
  });
});

describe('arrivals play for the player, after the modal', () => {
  beforeEach(() => {
    clearSaveData();
    useGameStore.getState().hardReset();
  });

  it('animates the generators that arrived while away', async () => {
    seedArrivalSave();

    await mount();

    // Dismiss the "welcome back" modal, as a returning player would.
    await act(async () => {
      document.querySelector<HTMLElement>('.modal-backdrop')?.click();
    });

    // Past the stagger window.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(arrivalCards()).toContain('Senior Dev');
  });

  it('does not animate behind the modal', async () => {
    // The whole point of waiting. Cards animating under a backdrop are invisible,
    // so the player dismisses the summary to cards that already stopped moving.
    seedArrivalSave();

    await mount();

    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(arrivalCards()).toHaveLength(0);
    expect(useGameStore.getState().pendingArrivals.length).toBeGreaterThan(0);
  });

  it('names the arrivals in the modal, so dismissal means something', async () => {
    seedArrivalSave();

    await mount();

    const line = document.querySelector('.offline-arrivals');
    expect(line, 'modal should announce the arrivals').toBeTruthy();
    expect(line?.textContent).toContain('Senior Dev');
  });

  it('stays quiet when nothing arrived', async () => {
    seedSettledSave();

    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>('.modal-backdrop')?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(arrivalCards()).toHaveLength(0);
  });
});
