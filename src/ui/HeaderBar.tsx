/**
 * HeaderBar — live resource counters plus per-resource production rates.
 *
 * Every value is a Decimal rendered through `formatDecimal`, which keeps the
 * header readable from 0 all the way past 1e36.
 */
import type Decimal from 'break_infinity.js';
import { useGameStore } from '../game/gameStore';
import { formatDecimal } from '../game/formulas';
import { RESOURCE_LABELS } from '../game/types';

export interface HeaderBarProps {
  lifetimeCash: Decimal;
}

export function HeaderBar({ lifetimeCash }: HeaderBarProps) {
  const resources = useGameStore((s) => s.gameState.resources);
  const production = useGameStore((s) => s.transient.production);
  const techDebt = useGameStore((s) => s.gameState.prestige.techDebt);

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
        <div className="chip chip-accent">
          <span className="chip-label">Tech Debt</span>
          <span className="chip-value">{formatDecimal(techDebt)}</span>
        </div>
      </div>
    </header>
  );
}
