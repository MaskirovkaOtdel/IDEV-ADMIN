/**
 * GeneratorCard — one generator: owned count, live production, next cost, buy.
 *
 * Selectors are deliberately primitive (Decimal / number / boolean) because the
 * store hands out a fresh state object every tick; selecting a derived object
 * would re-render forever.
 */
import { useMemo, useState } from 'react';
import type { GeneratorId } from '../game/types';
import { useGameStore, type BuyAmount } from '../game/gameStore';
import { requireGenDef } from '../game/generators';
import { costForBulkPurchase, effectiveCostGrowth, formatDecimal, maxAffordable } from '../game/formulas';
import { BuyAmountToggle } from './BuyAmountToggle';
import { RESOURCE_UNITS } from '../game/labels';

export interface GeneratorCardProps {
  generatorId: GeneratorId;
}

export function GeneratorCard({ generatorId }: GeneratorCardProps) {
  const def = requireGenDef(generatorId);
  const [amount, setAmount] = useState<BuyAmount>(1);
  const [message, setMessage] = useState<string | null>(null);

  const owned = useGameStore((s) => s.gameState.generators[generatorId]?.owned ?? 0);
  const cash = useGameStore((s) => s.gameState.resources.cash);
  const discount = useGameStore((s) => s.transient.costDiscount);
  const growthDelta = useGameStore((s) => s.transient.costGrowthDelta);
  const rate = useGameStore((s) => s.transient.production.perGenerator[generatorId]);
  const buy = useGameStore((s) => s.buyGenerator);

  const growth = effectiveCostGrowth(def.costGrowth, growthDelta);

  const { cost, count, affordable } = useMemo(() => {
    const units = amount === 'max' ? maxAffordable(def.baseCost, growth, owned, cash, discount) : amount;
    const total = costForBulkPurchase(def.baseCost, growth, owned, units, discount);
    return { cost: total, count: units, affordable: units > 0 && cash.greaterThanOrEqualTo(total) };
  }, [amount, cash, def.baseCost, discount, growth, owned]);

  const buyLabel = amount === 'max' ? `Buy MAX (${count})` : `Buy ×${amount}`;

  return (
    <article className={`card generator-card ${affordable ? 'is-affordable' : ''}`}>
      <header className="card-header">
        <span className="card-icon" aria-hidden="true">
          {def.icon}
        </span>
        <div className="card-heading">
          <h3 className="card-title">{def.name}</h3>
          <p className="card-flavor">{def.flavor}</p>
        </div>
        <span className="owned-badge">{owned}</span>
      </header>

      <dl className="card-stats">
        <div>
          <dt>Production</dt>
          <dd>
            {formatDecimal(rate)} {RESOURCE_UNITS[def.produces]}/s
          </dd>
        </div>
        <div>
          <dt>Each</dt>
          <dd>{formatDecimal(def.baseRate)}/s</dd>
        </div>
        <div>
          <dt>Cost growth</dt>
          <dd>×{growth.toFixed(2)}</dd>
        </div>
      </dl>

      <BuyAmountToggle value={amount} onChange={setAmount} />

      <button
        type="button"
        className="btn btn-primary"
        disabled={!affordable}
        onClick={() => {
          const result = buy(generatorId, amount);
          if (!result.ok) {
            setMessage(result.error ?? 'Purchase failed');
            return;
          }
          setMessage(null);
        }}
      >
        {buyLabel} · {formatDecimal(cost)} cash
      </button>

      {message && <p className="card-error">{message}</p>}
    </article>
  );
}
