/**
 * Accessibility of the event layer and the welcome-back modal.
 *
 * WHY
 * ---
 * Two gaps, both found by auditing rather than by playing:
 *
 *   1. The whole event layer was motion. There were ZERO `aria-live` regions in
 *      the codebase, so a purchase, an arrival and a reset were all invisible to
 *      a screen reader. The state was correct; only the channel was missing.
 *
 *   2. `OfflineReportModal` had no `role`, no `aria-modal`, no Escape handler and
 *      no focus management -- while `ConfirmResetModal` had a role. It is the
 *      dialog every returning player sees, so it is the one where that matters.
 *
 * `?motion=force` also lives here: it exists to answer "are the effects actually
 * visible?", which is unanswerable for anyone whose OS has reduced motion on.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import App from '../App';
import { useGameStore } from '../game/gameStore';
import { clearSaveData, KEY_CURRENT, saveGameState } from '../game/storage';
import { createInitialState } from '../game/serialize';
import { dec } from '../game/decimal';
import { MIN_OFFLINE_SECONDS_FOR_REPORT } from '../game/offline';
import {
  DEFAULT_SETTINGS,
  KEY_SETTINGS,
  motionAllowed,
  updateSettings,
  __resetSettingsForTest,
} from '../game/settings';

const HOUR_MS = 60 * 60 * 1000;

async function mount(settleMs = 250) {
  render(<App />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  });
}

function rewindSave(elapsedMs: number) {
  const raw = localStorage.getItem(KEY_CURRENT);
  const parsed = JSON.parse(raw!) as { savedAt: number; lastTickAt: number };
  parsed.savedAt -= elapsedMs;
  parsed.lastTickAt -= elapsedMs;
  localStorage.setItem(KEY_CURRENT, JSON.stringify(parsed));
}

/** A save whose offline walk crosses the seniorDev threshold. */
function seedOfflineArrival() {
  useGameStore.getState().hardReset();
  const saved = createInitialState();
  saved.resources.cash = dec(0);
  saved.resources.lifetimeCash = dec(200);
  saved.generators.juniorDev = { owned: 1, unlocked: true };
  saveGameState(saved);
  rewindSave(HOUR_MS);
}

const liveRegion = () => document.querySelector('[role="status"][aria-live="polite"]');

beforeEach(() => {
  clearSaveData();
  localStorage.removeItem(KEY_SETTINGS);
  __resetSettingsForTest();
  useGameStore.getState().hardReset();
  delete document.documentElement.dataset.motion;
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(KEY_SETTINGS);
  __resetSettingsForTest();
  delete document.documentElement.dataset.motion;
});

describe('the event layer is announced, not just animated', () => {
  it('has exactly one polite live region, mounted from the start', () => {
    // A live region added to the DOM at the same moment as its text is
    // unreliable: several screen readers only announce changes within an
    // already-present region, so mounting on demand drops the first message.
    render(<App />);
    const regions = document.querySelectorAll('[aria-live="polite"]');
    expect(regions).toHaveLength(1);
    expect(regions[0].className).toContain('sr-only');
  });

  it('is visually hidden without being hidden from assistive tech', () => {
    // `display: none` and `visibility: hidden` both remove the element from the
    // accessibility tree, which would silence the announcement entirely.
    //
    // Asserted against the BUILT stylesheet rather than getComputedStyle: jsdom
    // does not apply the imported stylesheet, so a computed-style check passes
    // vacuously here. The rule itself is verified in motion.test.ts.
    render(<App />);
    expect(liveRegion()?.className).toContain('sr-only');

    const css = readFileSync(resolve(import.meta.dirname, '..', '..', 'src', 'App.css'), 'utf8');
    const block = /\.sr-only\s*\{([^}]*)\}/.exec(css);
    expect(block, '.sr-only rule missing').toBeTruthy();
    const body = block![1];
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).not.toMatch(/display:\s*none/);
    expect(body).not.toMatch(/visibility:\s*hidden/);
    // The two properties that actually keep it out of sight while leaving it in
    // the accessibility tree.
    expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(body).toMatch(/width:\s*1px/);
  });

  it('announces a purchase', async () => {
    await mount();

    await act(async () => {
      const before = useGameStore.getState().gameState.generators.juniorDev.owned;
      useGameStore.setState((s) => ({
        gameState: {
          ...s.gameState,
          generators: {
            ...s.gameState.generators,
            juniorDev: { owned: before + 5, unlocked: true },
          },
        },
      }));
      // Past the coalescing window.
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(liveRegion()?.textContent).toMatch(/Hired Junior Dev/);
  });

  it('stays silent on mount rather than greeting the player with old purchases', async () => {
    // The property that matters: a save loaded with generators must not announce
    // them. On the first pass every generator already has a count, and treating
    // that as seven simultaneous purchases would tell a returning player about
    // things they bought hours ago.
    useGameStore.getState().hardReset();
    const saved = createInitialState();
    saved.resources.cash = dec(50_000);
    saved.generators.juniorDev = { owned: 40, unlocked: true };
    saved.generators.seniorDev = { owned: 25, unlocked: true };
    saveGameState(saved);

    await mount();
    expect(liveRegion()?.textContent ?? '').not.toMatch(/Hired/);

    // ...but a real purchase afterwards does announce.
    await act(async () => {
      useGameStore.setState((s) => ({
        gameState: {
          ...s.gameState,
          generators: { ...s.gameState.generators, seniorDev: { owned: 26, unlocked: true } },
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(liveRegion()?.textContent).toMatch(/Hired Senior Dev ×26/);
  });

  it('announces arrivals, including the offline batch', async () => {
    // The observable contract: after the modal is dismissed, the arrival is
    // announced.
    //
    // NOTE ON WHAT THIS DOES NOT VERIFY. LiveRegion guards the arrival
    // announcement on the modal being gone, so it does not fire during the dialog
    // that is already describing the same thing out loud. Deleting that guard
    // leaves this test passing -- the arrival is announced at mount and then
    // immediately overwritten by the offline message, and the coalescing timer
    // means the final text is identical. The guard prevents a duplicate, which is
    // only observable in the ordering, so it is not independently testable here.
    // Recorded rather than papered over.
    seedOfflineArrival();
    await mount();

    await act(async () => {
      document.querySelector<HTMLElement>('.modal-backdrop')?.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(liveRegion()?.textContent).toMatch(/Senior Dev/);
  });

  it('announces a reset', async () => {
    seedOfflineArrival();
    await mount();
    await act(async () => {
      document.querySelector<HTMLElement>('.modal-backdrop')?.click();
    });

    await act(async () => {
      useGameStore.setState((s) => ({
        gameState: {
          ...s.gameState,
          stats: { ...s.gameState.stats, prestigeCount: s.gameState.stats.prestigeCount + 1 },
        },
      }));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(liveRegion()?.textContent).toMatch(/reset/i);
  });
});

describe('the welcome-back modal is a real dialog', () => {
  async function mountWithModal() {
    useGameStore.getState().hardReset();
    const saved = createInitialState();
    saved.resources.cash = dec(0);
    saved.resources.lifetimeCash = dec(5000);
    saved.generators.juniorDev = { owned: 20, unlocked: true };
    saveGameState(saved);
    rewindSave(HOUR_MS);
    await mount();
  }

  it('declares itself a dialog with a name', async () => {
    await mountWithModal();

    const dialog = document.querySelector('.modal-window');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');

    const labelledBy = dialog?.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe('Welcome back');
  });

  it('moves focus into the dialog on open', async () => {
    await mountWithModal();

    const dismiss = screen.getByRole('button', { name: /back to work/i });
    expect(document.activeElement).toBe(dismiss);
  });

  it('closes on Escape', async () => {
    await mountWithModal();
    expect(document.querySelector('.modal-window')).toBeTruthy();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.querySelector('.modal-window')).toBeNull();
  });

  it('traps Tab inside the dialog', async () => {
    // Without this, Tab walks out of the dialog into the page behind it and focus
    // is lost with no way back.
    //
    // Asserts the handler MOVED focus, not merely that focus stayed inside. jsdom
    // does not implement Tab navigation at all, so "focus is still in the dialog"
    // is true whether or not the trap exists -- the first version of this test
    // passed with the trap deleted, for exactly that reason.
    await mountWithModal();
    const dialog = document.querySelector('.modal-window')!;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button')];
    expect(focusable.length).toBeGreaterThan(1);

    const last = focusable[focusable.length - 1];
    const first = focusable[0];

    // Tab from the last element must wrap to the first, and must be prevented.
    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => {
      document.dispatchEvent(forward);
    });
    expect(forward.defaultPrevented, 'Tab at the end should be intercepted').toBe(true);
    expect(document.activeElement).toBe(first);

    // Shift+Tab from the first must wrap back to the last.
    const backward = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.dispatchEvent(backward);
    });
    expect(backward.defaultPrevented, 'Shift+Tab at the start should be intercepted').toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('does not render at all for a trivial absence', async () => {
    // Nothing to announce means no dialog, and therefore no focus theft.
    useGameStore.getState().hardReset();
    const saved = createInitialState();
    saved.resources.lifetimeCash = dec(100);
    saved.generators.juniorDev = { owned: 1, unlocked: true };
    saveGameState(saved);
    rewindSave(MIN_OFFLINE_SECONDS_FOR_REPORT * 1000 - 2000);

    await mount();
    expect(document.querySelector('.modal-window')).toBeNull();
  });
});

describe('motion preference', () => {
  /**
   * jsdom has no real `prefers-reduced-motion`, so it is stubbed. This is the whole
   * point of the tri-state design: the default has to be *derived* from the OS,
   * and that derivation cannot be asserted without controlling the OS answer.
   */
  function stubPrefersReduced(matches: boolean) {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? matches : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    return () => {
      window.matchMedia = original;
    };
  }

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('defaults to following the system, not overriding it', () => {
    // A boolean defaulting to true would set data-motion for everybody, silently
    // overriding the OS accessibility preference. That is the bug the tri-state
    // exists to prevent.
    expect(DEFAULT_SETTINGS.motion).toBe('system');
  });

  it('respects a system that asks for reduced motion', async () => {
    const restore = stubPrefersReduced(true);
    try {
      render(<App />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(document.documentElement.dataset.motion).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('plays the effects when the system does not ask for reduced motion', async () => {
    const restore = stubPrefersReduced(false);
    try {
      render(<App />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(document.documentElement.dataset.motion).toBe('force');
    } finally {
      restore();
    }
  });

  it('?motion=force overrides a system that asked for reduced motion', async () => {
    const restore = stubPrefersReduced(true);
    window.history.replaceState({}, '', '/?motion=force');
    try {
      render(<App />);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      expect(document.documentElement.dataset.motion).toBe('force');
    } finally {
      restore();
    }
  });

  it('?motion=off overrides everything, including "always on"', () => {
    updateSettings({ motion: 'always' });
    expect(motionAllowed('?motion=off', false)).toBe(false);
    // The URL is a shareable override and must win over the saved preference.
    expect(motionAllowed('?motion=force', true, 'never')).toBe(true);
  });
});
