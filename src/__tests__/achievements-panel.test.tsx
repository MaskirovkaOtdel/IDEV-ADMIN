/**
 * AchievementsPanel.
 *
 * The panel's job is to answer "what should I do next", which is the same job the
 * Upgrades panel took on in v0.5.0 after it shipped as a screen-height void
 * saying "Nothing to buy here right now".
 *
 * So the assertions here are mostly about what a LOCKED row shows. A locked row
 * that renders as a dimmed icon with no numbers is the failure this file exists to
 * prevent, and it passes a naive "renders without crashing" test perfectly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { AchievementsPanel } from '../ui/AchievementsPanel';
import { useGameStore } from '../game/gameStore';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID } from '../game/achievements';
import { createInitialState } from '../game/serialize';
import { clearSaveData } from '../game/storage';
import { dec } from '../game/decimal';
import type { GameState } from '../game/types';

function mount(state: Partial<GameState> = {}) {
  const base = createInitialState();
  useGameStore.setState({
    gameState: {
      ...base,
      ...state,
      stats: { ...base.stats, ...(state.stats ?? {}) },
      resources: { ...base.resources, ...(state.resources ?? {}) },
    },
    pendingAchievements: [],
  });
  return render(<AchievementsPanel />);
}

/** Own `n` junior devs, which is the cheapest way to move a count-based rule. */
function owned(n: number): Partial<GameState> {
  return {
    generators: {
      ...createInitialState().generators,
      juniorDev: { owned: n, unlocked: true },
    },
  };
}

/**
 * The status line of a row.
 *
 * Read via the class rather than by text, because the status deliberately
 * contains a visually-hidden prefix ("Earned." / "Locked.") alongside the visible
 * words. A `getByText(/Earned/)` therefore matches both the sr-only span and its
 * parent, and fails on "found multiple elements" — which says nothing about the
 * panel being correct.
 */
function statusOf(rowName: string): string {
  const row = screen.getByText(rowName).closest('li')!;
  return row.querySelector('.achievement-status')?.textContent ?? '';
}

function rowFor(rowName: string): HTMLElement {
  return screen.getByText(rowName).closest('li') as HTMLElement;
}

beforeEach(() => {
  clearSaveData();
});

afterEach(() => cleanup());

describe('the achievements panel', () => {
  it('lists every achievement, so none is hidden behind a filter', () => {
    mount();
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(ACHIEVEMENTS.length);
  });

  it('a locked row shows how far away it is, not just that it is locked', () => {
    // THE assertion in this file. Four of five owned must read as progress, or the
    // panel is the greyed-out grid this was designed not to be.
    mount(owned(4));
    const row = rowFor('Small Team');

    expect(within(row).getByText(/4 \/ 5/)).toBeTruthy();
    expect(statusOf('Small Team')).toMatch(/Locked/);
  });

  it('marks an earned row as earned in text, not only in colour', () => {
    mount({ ...owned(5), achievements: { team_of_5: 1700000000000 } });
    const row = rowFor('Small Team');

    expect(statusOf('Small Team')).toMatch(/Earned/);
    // The progress bar is redundant once earned and would imply work remains.
    expect(row.querySelector('.achievement-bar')).toBeNull();
    expect(row.className).toMatch(/is-earned/);
  });

  it('does not announce the earned status twice', () => {
    // The status carries an sr-only prefix so that a locked row, which shows only
    // a percentage, still says "Locked" in the accessibility tree. Applying that
    // prefix to an earned row as well produced "Earned. Earned", because the
    // visible word is already there — and a screen reader reads the concatenation.
    //
    // Found by looking at the rendered DOM, not by a test: every assertion here
    // passed while the duplication was shipping.
    mount({ ...owned(5), achievements: { team_of_5: 1700000000000 } });
    expect(statusOf('Small Team').trim()).toBe('Earned');
  });

  it('a locked row still says "Locked" to a screen reader', () => {
    // The counterpart: the visible text is a percentage, so the sr-only prefix is
    // the only thing announcing that the row is not yet earned.
    mount(owned(4));
    expect(statusOf('Small Team')).toMatch(/^Locked\./);
  });

  it('the progress bar and the text agree, because both read the same measure', () => {
    // 13 of 25 is 52%. If the bar and the label were computed separately this is
    // where they would drift — which is how the meter failed three releases.
    mount(owned(13));
    const bar = screen.getByRole('progressbar', { name: 'Department progress' });

    expect(bar.getAttribute('aria-valuenow')).toBe('52');
    const row = screen.getByText('Department').closest('li')!;
    expect(within(row).getByText(/13 \/ 25/)).toBeTruthy();
    expect(within(row).getByText(/52%/)).toBeTruthy();
  });

  it('a milestone measuring far past its target still renders a full bar', () => {
    // Lifetime cash measures 37.9x past the 1e9 target while the achievement is
    // still LOCKED (the record is empty). A width of 3790% would stretch the row
    // and its container across the panel.
    //
    // NOTE ON WHAT THIS ACTUALLY COVERS: it is the `isMet` early return in
    // progressFraction that produces the 1, not the Math.min clamp below it --
    // deleting the clamp leaves this test passing. See the comment on
    // progressFraction. This asserts the rendered width, which is the property
    // that actually matters to the layout.
    mount({ stats: { ...createInitialState().stats, totalCashEarned: dec(3.79e10) } });

    const bar = screen.getByRole('progressbar', { name: 'Series A progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    const fill = bar.querySelector('.achievement-bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('reports the earned count against the total', () => {
    mount({ achievements: { first_hire: 1, team_of_5: 2 } });
    const counter = screen.getByRole('progressbar', { name: 'Achievements earned' });
    expect(counter.getAttribute('aria-valuenow')).toBe('2');
    expect(counter.getAttribute('aria-valuemax')).toBe(String(ACHIEVEMENTS.length));
  });

  it('sorts locked achievements within a tier by how near they are', () => {
    // Tier 2 holds Small Team (3/5 = 0.6), Department (3/25 = 0.12) and Tooling
    // (8/10 = 0.8).
    //
    // The numbers matter. The first version of this test used 3 hired and no
    // upgrades, which sorts to exactly the definition order — Small Team, then
    // Department, then Tooling — so it passed with the sort deleted entirely. A
    // test that cannot distinguish sorted from unsorted is not a test.
    //
    // Here Tooling is nearest, so it must lead, and the definition order would put
    // it last.
    mount({
      ...owned(3),
      upgrades: {
        purchased: [
          'codeMaster',
          'pairProgramming',
          'codeReview',
          'linter',
          'testCoverage',
          'ciPipeline',
          'k8sCluster',
          'docs',
        ].slice(0, 8),
      },
    });

    const tier2 = screen.getByRole('heading', { name: 'Building a team' }).parentElement!;
    const order = within(tier2)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('strong')?.textContent ?? '');

    expect(order).toEqual(['Tooling', 'Small Team', 'Department']);
  });

  it('each row names its own progress, so the bars are distinguishable', () => {
    // Unlabelled progressbars are indistinguishable to a screen reader: five bars
    // all reading "progressbar, 0 to 100, now 52".
    mount(owned(12));
    for (const def of ACHIEVEMENTS) {
      if (def.id === 'first_hire') continue; // earned by owning anyone
      expect(
        screen.getByRole('progressbar', { name: `${def.name} progress` }),
        `no labelled progressbar for ${def.id}`
      ).toBeTruthy();
    }
  });

  it('every achievement name is present as readable text', () => {
    mount();
    for (const def of ACHIEVEMENTS) {
      expect(screen.getByText(def.name), `missing ${def.id}`).toBeTruthy();
    }
  });

  it('a fresh game shows nothing earned', () => {
    mount();
    const counter = screen.getByRole('progressbar', { name: 'Achievements earned' });
    expect(counter.getAttribute('aria-valuenow')).toBe('0');

    // And no row claims to be earned.
    for (const def of ACHIEVEMENTS) {
      expect(statusOf(def.name), `${def.id} claims Earned on a fresh game`).not.toMatch(
        /Earned/
      );
    }
  });
});

describe('the panel never claims an achievement is unearned after a prestige', () => {
  it('shows a record the store would keep even though the criterion lapsed', () => {
    // The record says earned; the criterion (owned count) says zero. The record is
    // the authority, and the panel must agree with it.
    mount({ ...owned(0), achievements: { team_of_25: 1700000000000 } });

    expect(statusOf('Department')).toMatch(/Earned/);
    expect(ACHIEVEMENTS_BY_ID.team_of_25).toBeTruthy();
  });
});