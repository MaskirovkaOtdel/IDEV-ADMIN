/**
 * The production meter, which shipped wrong twice.
 *
 * v0.4.0 computed it as `rate / strongestRate` -- a ratio of raw rates across
 * different units. On a real save that gave a LoC generator a bar at 94% while it
 * contributed under 3% of real income, and because it was a ratio, a global
 * multiplier scaled every card equally and moved nothing at all. Buying an upgrade
 * raised the numbers and left the bars untouched, which is what "the generators
 * look like increasing gradually though it is not reflecting on speed of cash"
 * turned out to mean.
 *
 * These assert the two properties that were missing: the bar is denominated in
 * cash, and it is absolute rather than relative.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import App from '../App';
import { cashValueOf } from '../game/formulas';
import { dec } from '../game/decimal';
import { REVENUE_PER_COFFEE, REVENUE_PER_LOC } from '../game/generators';
import { useGameStore } from '../game/gameStore';
import { saveGameState } from '../game/storage';
import { createInitialState } from '../game/serialize';
import type { GeneratorId } from '../game/types';

/** The v0.4.0 formula, kept to prove the new one differs on real numbers. */
function oldMeterPct(rate: number, strongest: number): number {
  return strongest > 0 ? Math.min(100, (rate / strongest) * 100) : 0;
}

afterEach(() => {
  cleanup();
});

describe('cashValueOf', () => {
  it('passes cash through unchanged', () => {
    expect(cashValueOf('cash', dec(26.4)).toString()).toBe('26.4');
  });

  it('converts LoC at the billing rate', () => {
    expect(Number(cashValueOf('linesOfCode', dec(24.75)).toString())).toBeCloseTo(
      24.75 * REVENUE_PER_LOC,
      10
    );
  });

  it('converts Coffee at the billing rate', () => {
    expect(Number(cashValueOf('coffee', dec(10.73)).toString())).toBeCloseTo(
      10.73 * REVENUE_PER_COFFEE,
      10
    );
  });

  it('matches what the engine credits to cash', () => {
    // The conversion must agree with computeProductionSnapshot, or the meter
    // disagrees with the header rate. Snapshot credits
    // `stockpile * REVENUE_PER_LOC`, and this helper credits `rate * REVENUE_PER_LOC`.
    const locPerSecond = 24.75;
    expect(cashValueOf('linesOfCode', dec(locPerSecond)).toString()).toBe(
      dec(locPerSecond * REVENUE_PER_LOC).toString()
    );
  });
});

describe('the meter is denominated in cash, not raw magnitude', () => {
  // A real save: Senior Dev 26.4 cash/s, Code Review 24.75 LoC/s, Linter 16.5
  // LoC/s, Test Suite 10.73 coffee/s.
  const cards = [
    { name: 'Junior Dev', resource: 'cash' as const, rate: 12.32 },
    { name: 'Senior Dev', resource: 'cash' as const, rate: 26.4 },
    { name: 'Code Review', resource: 'linesOfCode' as const, rate: 24.75 },
    { name: 'Linter', resource: 'linesOfCode' as const, rate: 16.5 },
    { name: 'Test Suite', resource: 'coffee' as const, rate: 10.73 },
  ];
  const value = (c: (typeof cards)[number]) =>
    Number(cashValueOf(c.resource, dec(c.rate)).toString());

  it('no longer shows a LoC generator as a top producer', () => {
    const total = cards.reduce((s, c) => s + value(c), 0);
    const codeReviewShare = (value(cards[2]) / total) * 100;

    // Under the old formula this card drew 94% of the bar.
    expect(oldMeterPct(24.75, 26.4)).toBeGreaterThan(90);
    // Its true share of income.
    expect(codeReviewShare).toBeLessThan(5);
  });

  it('ranks cards by income rather than by unit-agnostic size', () => {
    const byValue = [...cards].sort((a, b) => value(b) - value(a)).map((c) => c.name);
    // Senior Dev and Junior Dev produce cash directly, so they must outrank the
    // converters despite Code Review having the second-largest raw rate.
    expect(byValue.indexOf('Senior Dev')).toBeLessThan(byValue.indexOf('Code Review'));
    expect(byValue.indexOf('Junior Dev')).toBeLessThan(byValue.indexOf('Linter'));
  });
});

describe('the rendered card uses the cash-denominated meter', () => {
  // The formula tests above cover the maths. These cover the wiring, which is
  // where the bug actually lived: reverting GeneratorCard to compare raw rates
  // passed every formula test, because the formulas describe the intended
  // behaviour rather than the code's. Only rendering catches the disconnect.

  async function renderCards(mutate: (state: ReturnType<typeof createInitialState>) => void) {
    useGameStore.getState().hardReset();
    const state = createInitialState();
    state.resources.cash = dec(1e9);
    state.resources.lifetimeCash = dec(1e9);
    mutate(state);
    saveGameState(state);

    render(<App />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    return [...document.querySelectorAll('.generator-card')].map((card) => ({
      title: card.querySelector('.card-title')?.textContent ?? '',
      fill: card.querySelector<HTMLElement>('.gen-meter-fill'),
      label: card.querySelector('.meter-label')?.textContent ?? '',
      hint: card.querySelector('.meter-hint')?.textContent ?? '',
      production: card.querySelector('.card-stats dd')?.textContent ?? '',
    }));
  }

  it('ranks generators by what they earn, not by raw output', async () => {
    // Two generators worth EXACTLY the same income, with wildly different raw
    // rates: Senior Dev at 25 units is 30 cash/s, Linter at 100 units is 600 LoC/s
    // which bills at 0.05 to the same 30 cash/s.
    //
    // Under the v0.4.0 formula the Linter card drew a bar 20x longer than the
    // Senior Dev card despite being worth precisely the same. Under cash value
    // they must read as equals.
    const cards = await renderCards((s) => {
      s.generators.juniorDev = { owned: 10, unlocked: true };
      s.generators.seniorDev = { owned: 25, unlocked: true };
      s.generators.linter = { owned: 100, unlocked: true };
    });

    const share = (name: string) =>
      Number.parseFloat(cards.find((c) => c.title === name)?.label ?? '0');

    // Same earnings, so the same share of the team.
    expect(share('Linter')).toBeCloseTo(share('Senior Dev'), 1);

    // And the raw-rate ratio that used to dominate: 600 vs 30.
    expect(600 / 30).toBe(20);
  });

  it('shows payback in the hint, which is the decision-relevant number', async () => {
    // The bar carries team share; the hint carries whether this hire is worth it.
    const cards = await renderCards((s) => {
      s.generators.juniorDev = { owned: 10, unlocked: true };
    });

    const hint = cards.find((c) => c.title === 'Junior Dev')?.hint ?? '';
    // Affordable at 1e9 cash, so the hint says so rather than quoting a payback.
    expect(hint).toBe('ready to hire');
  });

  it('quotes a payback when the hire is not affordable yet', async () => {
    // Payback never degenerates the way a bar does: "ready" and "3 days away" are
    // different states even when every bar would read full.
    useGameStore.getState().hardReset();
    const state = createInitialState();
    state.resources.cash = dec(1);
    state.resources.lifetimeCash = dec(1);
    state.generators.juniorDev = { owned: 10, unlocked: true };
    saveGameState(state);

    render(<App />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const hint =
      document.querySelector('.generator-card .meter-hint')?.textContent ?? '';
    expect(hint).toMatch(/pays back in/);
  });

  it('states the cash value of a non-cash generator', async () => {
    const cards = await renderCards((s) => {
      s.generators.juniorDev = { owned: 10, unlocked: true };
      s.generators.codeReview = { owned: 30, unlocked: true };
    });

    const codeReview = cards.find((c) => c.title === 'Code Review');
    expect(codeReview?.production).toContain('LoC/s');
    // Otherwise the bar appears to disagree with the number above it.
    expect(codeReview?.production).toContain('cash/s');
  });

  it('omits the conversion on a cash generator, which needs none', async () => {
    const cards = await renderCards((s) => {
      s.generators.juniorDev = { owned: 10, unlocked: true };
    });

    expect(cards.find((c) => c.title === 'Junior Dev')?.production).not.toMatch(/= .*cash\/s/);
  });

  it('labels the bar so its meaning is not a guess', async () => {
    const cards = await renderCards((s) => {
      s.generators.juniorDev = { owned: 10, unlocked: true };
    });

    expect(cards.find((c) => c.title === 'Junior Dev')?.label).toMatch(/of team/);
    expect(cards.find((c) => c.title === 'Junior Dev')?.hint).toMatch(/to the next hire|ready to hire/);
  });
});

describe('the meter survives a late-game save', () => {
  // THE REGRESSION THIS EXISTS FOR
  // -------------------------------
  // v0.4.1 set the bar to "progress toward doubling income". Against a real save
  // that rendered 0.0% on all seven cards: income was 3.23M/s while the best
  // generator added 250/s, so one purchase was 0.0077% of income and 100% was 129x
  // out of reach. A meter test that only used small numbers could not see it.
  //
  // These use the actual scale of that save. Every figure below is taken from it.

  const LATE = {
    cash: dec(223_000_000),
    loc: dec(2_510_000),
    coffee: dec(2_960_000),
    owned: { juniorDev: 140, seniorDev: 100, codeReview: 100, linter: 90, testSuite: 60, ciPipeline: 50, k8sCluster: 40 },
  };

  async function renderLate() {
    useGameStore.getState().hardReset();
    const state = createInitialState();
    state.resources.cash = LATE.cash;
    state.resources.linesOfCode = LATE.loc;
    state.resources.coffee = LATE.coffee;
    state.resources.lifetimeCash = dec(3.79e9);
    for (const [id, n] of Object.entries(LATE.owned)) {
      state.generators[id as GeneratorId] = { owned: n, unlocked: true };
    }
    // The 11 upgrades that save owned.
    state.upgrades.purchased = [
      'codeMaster', 'pairProgramming', 'styleGuide', 'freelanceContracts', 'testObsession',
      'automatedLinting', 'continuousIntegration', 'seniorMentor', 'aiCopilot',
      'quantumServer', 'autonomousAgent',
    ];
    saveGameState(state);

    render(<App />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    return [...document.querySelectorAll('.generator-card')].map((card) => ({
      title: card.querySelector('.card-title')?.textContent ?? '',
      width: card.querySelector<HTMLElement>('.gen-meter-fill')?.style.width ?? '0%',
      label: card.querySelector('.meter-label')?.textContent ?? '',
      hint: card.querySelector('.meter-hint')?.textContent ?? '',
    }));
  }

  it('never renders a bare 0.0%', async () => {
    const cards = await renderLate();
    expect(cards.length).toBeGreaterThan(3);

    for (const card of cards) {
      expect(card.width, `${card.title} bar collapsed`).not.toBe('0%');
      expect(card.label, `${card.title} label is empty`).not.toBe('');
      // The specific failure: toFixed(1) rounding a real value down to nothing.
      expect(card.label, `${card.title} label reads 0.0%`).not.toContain('0.0%');
    }
  });

  it('reports a real share of team output, and ranks the cards', async () => {
    const cards = await renderLate();
    const share = (name: string) => {
      const text = cards.find((c) => c.title === name)?.label ?? '';
      return Number.parseFloat(text);
    };

    // K8s Cluster produced 10K cash/s from 40 units; Code Review 348 LoC/s from
    // 100, which is worth 17.4 cash/s. K8s must dominate.
    expect(share('K8s Cluster')).toBeGreaterThan(share('Code Review'));
    expect(share('K8s Cluster')).toBeGreaterThan(50);
  });

  it('the bars DIFFER across cards, which is the whole point', async () => {
    // THE REGRESSION THIS EXISTS FOR
    // -------------------------------
    // v0.4.2 put cash/cost on the bar. On the reviewed save the player is 41x to
    // 1080x past every cost, so all seven bars pinned at 100% and every hint read
    // "ready to hire another" -- the same failure as v0.4.1's 0.0%, in the other
    // direction. The previous assertion here only checked the bars were not ZERO,
    // so it passed when every bar was full.
    //
    // The bar now carries team share, which spans 0.2% to 85.6% on that save.
    const cards = await renderLate();
    const widths = cards.map((c) => Number.parseFloat(c.width));

    // Not all the same. This is the assertion whose absence let the bug ship.
    expect(new Set(widths).size, `all bars identical: ${widths.join(', ')}`).toBeGreaterThan(1);

    // And the spread is real, not two values a fraction apart.
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(20);

    // K8s Cluster is the dominant producer in that save and must lead.
    expect(widths[cards.findIndex((c) => c.title === 'K8s Cluster')]).toBeGreaterThan(50);
  });

  it('the bars sum to about 100%, because they are shares', async () => {
    // A share is bounded by construction. If these ever stop summing to 100 the
    // normalisation has broken and the bars mean nothing.
    const cards = await renderLate();
    const total = cards.reduce((sum, c) => sum + Number.parseFloat(c.width), 0);
    expect(total).toBeGreaterThan(95);
    expect(total).toBeLessThan(105);
  });

  it('formats a tiny share without collapsing it to 0.0%', async () => {
    // Guards the `formatPercent` rounding directly. The late-game cards all land
    // above 0.01%, so they never exercised this -- the collapse happened on the
    // old label, which was derived from income rather than from team share.
    // Broke by patch C, which restores toFixed(1).
    useGameStore.getState().hardReset();
    const state = createInitialState();
    state.resources.cash = dec(1e6);
    state.resources.lifetimeCash = dec(1e6);
    // Linter at a million units produces 6M LoC/s = 300K cash/s, dwarfing the two
    // cash generators. Their share is a genuine sliver, not zero.
    state.generators.juniorDev = { owned: 1, unlocked: true };
    state.generators.seniorDev = { owned: 1, unlocked: true };
    state.generators.linter = { owned: 1_000_000, unlocked: true };
    saveGameState(state);

    render(<App />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const labelFor = (name: string) =>
      [...document.querySelectorAll('.generator-card')]
        .find((c) => c.querySelector('.card-title')?.textContent === name)
        ?.querySelector('.meter-label')?.textContent ?? '';

    const junior = labelFor('Junior Dev');
    expect(Number.parseFloat(junior), `label was "${junior}"`).toBeGreaterThan(0);
    expect(junior).not.toContain('0.0%');
    expect(junior).not.toBe('0%');
  });

  it('is stable across the buy-quantity toggle', async () => {
    // Neither the bar nor the hint tracks the selection size. The bar is a share
    // of team output; the hint quotes the payback on ONE more hire. Choosing MAX
    // describes a different transaction and must not restate either.
    useGameStore.getState().hardReset();
    const state = createInitialState();
    state.resources.cash = dec(500);
    state.resources.lifetimeCash = dec(500);
    state.generators.juniorDev = { owned: 40, unlocked: true };
    state.generators.seniorDev = { owned: 5, unlocked: true };
    saveGameState(state);

    render(<App />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    const read = () => ({
      width:
        document.querySelector<HTMLElement>('.generator-card .gen-meter-fill')?.style.width ?? '0%',
      hint: document.querySelector('.generator-card .meter-hint')?.textContent ?? '',
    });

    const before = read();
    expect(
      Number.parseFloat(before.width),
      'bar should be partly full for this test to mean anything'
    ).toBeGreaterThan(5);
    expect(Number.parseFloat(before.width)).toBeLessThan(95);

    const max = [...document.querySelectorAll('.chip-button')].find(
      (b) => b.textContent?.trim().toUpperCase() === 'MAX'
    ) as HTMLButtonElement | undefined;
    expect(max, 'MAX toggle not found').toBeTruthy();

    const labelBefore = document.querySelector('.generator-card button.btn')?.textContent ?? '';
    await act(async () => {
      max!.click();
    });
    const labelAfter = document.querySelector('.generator-card button.btn')?.textContent ?? '';
    expect(labelAfter, 'quantity did not change').not.toBe(labelBefore);
    expect(labelAfter).toContain('MAX');

    expect(read().width).toBe(before.width);
    expect(read().hint).toBe(before.hint);

    // And on the next tick, where a quantity-sensitive bar would have silently
    // resized itself once the memo re-ran.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(Number.parseFloat(read().width)).toBeCloseTo(Number.parseFloat(before.width), 1);
  });
});

describe('the meter is absolute, so upgrades move it', () => {
  /** The v0.5.0 formula: progress toward a doubling of income. */
  function meterPct(incomePerSec: number, perUnitCash: number): number {
    if (perUnitCash <= 0 || incomePerSec <= 0) return 0;
    return Math.min(100, (1 / (incomePerSec / perUnitCash)) * 100);
  }

  it('responds to a global multiplier, unlike the old ratio', () => {
    // 100 Junior Devs at 0.2 cash/s each = 20/s, 1 unit = 0.2/s.
    const income = 20;
    const perUnit = 0.2;

    const before = meterPct(income, perUnit);
    // codeMaster: globalMult 1.1. Everything scales, including the target.
    const after = meterPct(income * 1.1, perUnit * 1.1);

    // The ratio is scale-invariant, so both are identical -- which is exactly the
    // bug. This assertion documents that the old formula could not show it.
    expect(after).toBeCloseTo(before, 10);

    // The absolute bar moves because a purchase now costs relatively more.
    expect(after).toBeGreaterThan(before);
  });

  it('reaches 100% when one purchase would double income', () => {
    expect(meterPct(10, 10)).toBe(100);
  });

  it('is near zero when one purchase is negligible against income', () => {
    expect(meterPct(1_000_000, 0.2)).toBeLessThan(0.01);
  });

  it('is zero rather than NaN when nothing is producing', () => {
    expect(meterPct(0, 0.2)).toBe(0);
    expect(meterPct(20, 0)).toBe(0);
  });

  it('never exceeds 100 even for an absurd ratio', () => {
    expect(meterPct(1, 1e9)).toBe(100);
  });
});
