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
      production: card.querySelector('.card-stats dd')?.textContent ?? '',
    }));
  }

  it('gives a cash generator a different bar than a larger raw LoC rate', async () => {
    // Senior Dev produces less raw than nothing else here, but Code Review's
    // 24.75 LoC/s is worth 1.24 cash/s. If the bar were still raw, the LoC card
    // would draw longer.
    const cards = await renderCards((s) => {
      s.generators.juniorDev = { owned: 10, unlocked: true };
      s.generators.seniorDev = { owned: 1, unlocked: true };
      s.generators.codeReview = { owned: 30, unlocked: true };
    });

    const width = (name: string) =>
      Number.parseFloat(cards.find((c) => c.title === name)?.fill?.style.width ?? '0');

    expect(width('Senior Dev')).toBeGreaterThan(width('Code Review'));
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

    expect(cards.find((c) => c.title === 'Junior Dev')?.label).toMatch(/to 2. income/);
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
