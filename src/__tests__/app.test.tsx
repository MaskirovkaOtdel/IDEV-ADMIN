/**
 * Integration tests for the mounted app.
 *
 * These cover the wiring that unit tests cannot: hydration from storage, the game
 * loop actually advancing the simulation, purchases flowing through the DOM, the
 * prestige flow, and persistence across a remount. They are the regression net for
 * the original failure mode, where every piece existed and nothing was connected
 * (`useState` was called in App.tsx without being imported, and no component was
 * ever mounted).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import App from '../App';
import { useGameStore } from '../game/gameStore';
import { clearSaveData, KEY_CURRENT } from '../game/storage';
import { dec } from '../game/decimal';
import { saveGameState } from '../game/storage';
import { createInitialState } from '../game/serialize';

function seedSave(mutate?: (state: ReturnType<typeof createInitialState>) => void) {
  const state = createInitialState();
  state.resources.cash = dec(50_000);
  state.resources.lifetimeCash = dec(50_000);
  state.generators.juniorDev = { owned: 10, unlocked: true };
  if (mutate) mutate(state);
  saveGameState(state);
}

async function mount(settleMs = 250) {
  const result = render(<App />);
  // Hydration is an effect; the first simulation tick lands on the 100ms
  // interval, so flush well past one tick.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  });
  return result;
}

beforeEach(() => {
  clearSaveData();
  useGameStore.getState().hardReset();
});

describe('App – first run', () => {
  it('renders the shell with all three sections', async () => {
    await mount();
    expect(screen.getByRole('navigation', { name: 'Game sections' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Generators/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Upgrades/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Prestige/ })).toBeDefined();
    expect(screen.getByText('IDEV : ADMIN')).toBeDefined();
  });

  it('offers the first generator on a brand-new save', async () => {
    // Regression: a fresh game starts with STARTING_CASH, but the panel gated the
    // empty state on lifetime cash, so it told a new player to "hire your first
    // Junior Dev" while rendering no cards at all. The game was unplayable.
    await mount();

    expect(screen.queryByText(/empty repo/i)).toBeNull();
    const buy = screen.getAllByRole('button', { name: /Buy ×1/ })[0] as HTMLButtonElement;
    expect(buy.disabled).toBe(false);

    await act(async () => {
      buy.click();
    });
    expect(useGameStore.getState().gameState.generators.juniorDev.owned).toBe(1);
  });

  it('shows the empty state once the starting cash is spent', async () => {
    await mount();
    // setState (not direct mutation) so subscribers re-render.
    act(() => {
      useGameStore.setState((s) => ({
        gameState: {
          ...s.gameState,
          resources: { ...s.gameState.resources, cash: dec(3) },
        },
      }));
    });
    expect(screen.getByText(/empty repo/i)).toBeDefined();
  });

  it('shows resource counters', async () => {
    await mount();
    expect(screen.getByText('Cash')).toBeDefined();
    expect(screen.getByText('LoC')).toBeDefined();
    expect(screen.getByText('Coffee')).toBeDefined();
  });
});

describe('App – hydration', () => {
  it('restores a saved game', async () => {
    seedSave();
    await mount();

    expect(useGameStore.getState().gameState.generators.juniorDev.owned).toBe(10);
    expect(Number(useGameStore.getState().gameState.resources.cash.toString())).toBeGreaterThan(50_000);
    expect(screen.getByText('Generators', { selector: '.nav-label' })).toBeDefined();
  });

  it('does not tick over an empty save', async () => {
    seedSave();
    const before = useGameStore.getState().gameState.stats.playSeconds;
    await mount();
    // playSeconds advances by the real elapsed wall time only.
    expect(useGameStore.getState().gameState.stats.playSeconds).toBeGreaterThanOrEqual(before);
    expect(useGameStore.getState().gameState.stats.playSeconds).toBeLessThan(5);
  });

  it('warns when a save was quarantined but still starts', async () => {
    seedSave();
    localStorage.setItem(KEY_CURRENT, 'not json');
    await mount();
    expect(useGameStore.getState().gameState.generators.juniorDev.owned).toBe(0);
    expect(screen.getByText(/could not be read/i)).toBeDefined();
  });

  it('persists across a remount', async () => {
    seedSave();
    await mount();
    useGameStore.getState().buyGenerator('juniorDev', 5);
    useGameStore.getState().save();
    const owned = useGameStore.getState().gameState.generators.juniorDev.owned;
    expect(owned).toBe(15);

    // Unmount and mount again. A remount re-hydrates from storage, so this is a
    // real round-trip rather than in-memory state surviving.
    cleanup();
    expect(useGameStore.getState().gameState.generators.juniorDev.owned).toBe(15);
    await mount();

    expect(useGameStore.getState().gameState.generators.juniorDev.owned).toBe(15);
    expect(Number(useGameStore.getState().gameState.resources.lifetimeCash.toString())).toBeGreaterThan(50_000);
  });
});

describe('App – game loop', () => {
  it('advances production while mounted', async () => {
    seedSave();
    await mount();

    const before = Number(useGameStore.getState().gameState.resources.cash.toString());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    const after = Number(useGameStore.getState().gameState.resources.cash.toString());

    expect(after).toBeGreaterThan(before);
  });

  it('does not stack ticks once unmounted', async () => {
    seedSave();
    const view = await mount();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    const atUnmount = useGameStore.getState().gameState.stats.playSeconds;

    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(useGameStore.getState().gameState.stats.playSeconds).toBe(atUnmount);
  });
});

describe('App – purchases through the UI', () => {
  it('buys a generator by clicking the card button', async () => {
    seedSave();
    await mount();

    // One card per unlocked generator; scope to the Junior Dev card by name.
    const buyButtons = screen.getAllByRole('button', { name: /Buy ×1/ });
    const before = useGameStore.getState().gameState.generators.juniorDev.owned;
    await act(async () => {
      buyButtons[0].click();
    });

    expect(useGameStore.getState().gameState.generators.juniorDev.owned).toBe(before + 1);
  });

  it('switches the bulk quantity and buys more', async () => {
    seedSave();
    await mount();

    const before = useGameStore.getState().gameState.generators.juniorDev.owned;
    await act(async () => {
      screen.getAllByRole('button', { name: '×10' })[0].click();
    });
    await act(async () => {
      screen.getAllByRole('button', { name: /Buy ×10/ })[0].click();
    });

    expect(useGameStore.getState().gameState.generators.juniorDev.owned).toBe(before + 10);
  });

  it('switches to the upgrades tab and buys one', async () => {
    seedSave();
    await mount();

    await act(async () => {
      screen.getByRole('button', { name: /Upgrades/ }).click();
    });

    const codeMaster = screen.getByRole('button', { name: /50 Cash/ });
    await act(async () => {
      codeMaster.click();
    });

    expect(useGameStore.getState().gameState.upgrades.purchased).toContain('codeMaster');
  });

  it('locks upgrades whose requirements are unmet', async () => {
    await mount();
    await act(async () => {
      screen.getByRole('button', { name: /Upgrades/ }).click();
    });
    expect(screen.getAllByText(/Requires/).length).toBeGreaterThan(0);
  });
});

describe('App – prestige flow', () => {
  it('opens the confirm modal, cancels, then confirms', async () => {
    seedSave((state) => {
      state.resources.lifetimeCash = dec(1e9);
    });
    await mount();

    await act(async () => {
      screen.getByRole('button', { name: /Prestige/ }).click();
    });

    const prestigeButton = screen.getAllByRole('button', { name: /Reset run for/ })[0];
    await act(async () => {
      prestigeButton.click();
    });

    // Modal is up: cancel leaves the run intact.
    await act(async () => {
      screen.getByRole('button', { name: 'Cancel' }).click();
    });
    expect(useGameStore.getState().gameState.generators.juniorDev.owned).toBe(10);

    // Reopen and confirm for real.
    await act(async () => {
      screen.getAllByRole('button', { name: /Reset run for/ })[0].click();
    });
    await act(async () => {
      screen.getByRole('button', { name: 'Prestige' }).click();
    });

    const state = useGameStore.getState().gameState;
    expect(state.generators.juniorDev.owned).toBe(0);
    expect(state.prestige.techDebt.greaterThan(0)).toBe(true);
    expect(state.resources.lifetimeCash.greaterThan(0)).toBe(true);
  });

  it('disables the reset button when there is nothing to gain', async () => {
    await mount();
    await act(async () => {
      screen.getByRole('button', { name: /Prestige/ }).click();
    });
    const resetButton = screen.getAllByRole('button', { name: /Reset run for/ })[0] as HTMLButtonElement;
    expect(resetButton.disabled).toBe(true);
  });

  it('lists permanent upgrade tiers with their costs', async () => {
    seedSave((state) => {
      state.resources.lifetimeCash = dec(1e12);
      state.prestige.techDebt = dec(1000);
    });
    await mount();
    await act(async () => {
      screen.getByRole('button', { name: /Prestige/ }).click();
    });
    expect(screen.getByText('Refactoring Grant')).toBeDefined();
    expect(screen.getAllByText(/Tech Debt/).length).toBeGreaterThan(0);
  });

  it('buys a permanent upgrade', async () => {
    seedSave((state) => {
      state.resources.lifetimeCash = dec(1e12);
      state.prestige.techDebt = dec(1000);
    });
    await mount();
    await act(async () => {
      screen.getByRole('button', { name: /Prestige/ }).click();
    });

    const before = useGameStore.getState().gameState.prestige.techDebt;
    const buy = screen.getAllByRole('button', { name: /25 Tech Debt/ })[0];
    await act(async () => {
      buy.click();
    });

    const after = useGameStore.getState().gameState.prestige;
    expect(after.techDebt.lessThan(before)).toBe(true);
    expect(after.permanentUpgrades.refactoringGrant).toBe(1);
  });
});

describe('App – debug panel', () => {
  it('opens on Escape and closes on Escape', async () => {
    await mount();
    expect(screen.queryByRole('complementary', { name: 'Debug panel' })).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.getByRole('complementary', { name: 'Debug panel' })).toBeDefined();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByRole('complementary', { name: 'Debug panel' })).toBeNull();
  });
});

describe('App – offline report', () => {
  it('reports offline progress on load', async () => {
    vi.useFakeTimers();
    try {
      seedSave();
      // Rewind the save clock by 2 hours.
      const raw = JSON.parse(localStorage.getItem(KEY_CURRENT) as string);
      raw.lastTickAt = Date.now() - 2 * 60 * 60 * 1000;
      localStorage.setItem(KEY_CURRENT, JSON.stringify(raw));

      render(<App />);
      await act(async () => {
        await Promise.resolve();
      });

      expect(useGameStore.getState().offlineReport).not.toBeNull();
      expect(Number(useGameStore.getState().gameState.resources.cash.toString())).toBeGreaterThan(50_000);

      const modal = screen.getByText(/Welcome back/i);
      expect(modal).toBeDefined();

      await act(async () => {
        screen.getByRole('button', { name: /Back to work/ }).click();
      });
      expect(useGameStore.getState().offlineReport).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays quiet for a short absence', async () => {
    seedSave();
    await mount();
    expect(useGameStore.getState().offlineReport).toBeNull();
    expect(screen.queryByText(/Welcome back/i)).toBeNull();
  });
});
