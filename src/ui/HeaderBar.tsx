/**
 * HeaderBar — live resource counters plus per-resource production rates.
 *
 * Every value is a Decimal rendered through `formatDecimal`, which keeps the
 * header readable from 0 all the way past 1e36.
 */
import { useMemo } from 'react';
import type Decimal from 'break_infinity.js';
import { useGameStore } from '../game/gameStore';
import { formatDecimal } from '../game/formulas';
import { RESOURCE_LABELS } from '../game/types';
import { techDebtForLifetimeCash } from '../game/prestige';
import { dec, ZERO } from '../game/decimal';

/**
 * The cheapest permanent upgrade, in Tech Debt.
 *
 * The threshold for "a reset is worth advertising". Below it a reset banks
 * nothing spendable, so promoting it would be noise. Above it the player is
 * leaving permanent upgrades unclaimed by not resetting.
 *
 * Mirrors PERM_UPGRADE_DEFS rather than hardcoding a number that could drift out
 * of step with the upgrade tree.
 */
const FIRST_PERM_COST = 25;

/** Lifetime cash earned since the last reset. Mirrors `runLifetimeCash`. */
function runLifetimeCashFrom(lifetimeCash: Decimal, baseline: Decimal | undefined): Decimal {
  const earned = lifetimeCash.minus(baseline ?? ZERO);
  return earned.lessThan(ZERO) ? ZERO : earned;
}

export interface HeaderBarProps {
  lifetimeCash: Decimal;
}

export function HeaderBar({ lifetimeCash }: HeaderBarProps) {
  const resources = useGameStore((s) => s.gameState.resources);
  const production = useGameStore((s) => s.transient.production);
  const techDebt = useGameStore((s) => s.gameState.prestige.techDebt);

  // What a reset would bank right now.
  //
  // Built from the same two inputs `computeTechDebtGained` reads, rather than
  // calling it inside a selector: it allocates a fresh Decimal every call, and a
  // zustand selector returning a new object each time re-renders forever under v5.
  // That produced "Maximum update depth exceeded" on the first attempt.
  //
  // Selecting primitives individually keeps the comparison referentially stable,
  // which is what the store hands out anyway.
  const bankedLifetimeCash = useGameStore((s) => s.gameState.prestige.baselineLifetimeCash);
  const pendingTechDebt = useMemo(
    () => techDebtForLifetimeCash(runLifetimeCashFrom(lifetimeCash, bankedLifetimeCash)),
    [lifetimeCash, bankedLifetimeCash]
  );
  const resetWorthShowing = pendingTechDebt.greaterThan(dec(FIRST_PERM_COST));

  const rows = [
    {
      id: 'cash' as const,
      label: RESOURCE_LABELS.cash,
      value: resources.cash,
      rate: production.perResource.cash,
      hint: 'buys generators',
    },
    {
      id: 'linesOfCode' as const,
      label: RESOURCE_LABELS.linesOfCode,
      value: resources.linesOfCode,
      rate: production.perResource.linesOfCode,
      hint: 'bills out as cash',
    },
    {
      id: 'coffee' as const,
      label: RESOURCE_LABELS.coffee,
      value: resources.coffee,
      rate: production.perResource.coffee,
      hint: 'bills out as cash',
    },
  ];

  return (
    <header className="header-bar">
      <div className="resource-grid">
        {rows.map((row) => (
          <div key={row.id} className="resource-cell">
            <span className="resource-label">{row.label}</span>
            <span className="resource-value">{formatDecimal(row.value)}</span>
            <span className="resource-rate">
              +{formatDecimal(row.rate)}/s
              <span className="resource-hint"> {row.hint}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="header-side">
        <div className="chip">
          <span className="chip-label">Lifetime cash</span>
          <span className="chip-value">{formatDecimal(lifetimeCash)}</span>
        </div>

        {/* What a reset would pay, not just what has been banked.
         *
         * "Tech Debt 0" is the number you have *spent*, and for a player who has
         * never prestiged it stays 0 forever while a real fortune sits behind it.
         * In one save reviewed here: 3.79B lifetime cash, 402 debt available, and
         * a header reading 0. Twenty-two permanent upgrades were unreachable
         * behind a number that gave no reason to open the Prestige tab.
         *
         * Both figures are shown because they answer different questions --
         * "what would I get" and "what have I banked" -- and only the second one
         * was previously visible. */}
        <div
          className={`chip chip-accent ${resetWorthShowing ? 'chip-actionable' : ''}`}
          title="What a run reset would bank as Tech Debt"
        >
          <span className="chip-label">
            Tech Debt
            {resetWorthShowing && <span className="chip-badge">reset available</span>}
          </span>
          <span className="chip-value">{formatDecimal(techDebt)}</span>
          {resetWorthShowing && (
            <span className="chip-sub">+{formatDecimal(pendingTechDebt)} on reset</span>
          )}
        </div>
      </div>
    </header>
  );
}
