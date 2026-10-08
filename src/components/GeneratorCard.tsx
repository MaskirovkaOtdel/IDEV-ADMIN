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
import { usePulse } from '../game/useFlash';

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

  // Event layer, driven by real state rather than a timer.
  //
  // `owned` is the trigger for the purchase flash: it only changes when a
  // purchase lands, so it is a faithful proxy for "the player bought something"
  // without the card subscribing to its own click handler. `unlocked` is the
  // generator appearing, which is the moment the game pays the player.
  const bought = usePulse(owned);
  // Generators arrive already-unlocked, so the card mounts rather than
  // transitioning. Reading the flag through the store (rather than at module
  // scope) keeps this correct if a save is hydrated to a mid-game state.
  const unlockedFlag = useGameStore((s) => s.gameState.generators[generatorId]?.unlocked === true);
  const justUnlocked = usePulse(unlockedFlag, 900);

  // The meter shows live output. It is scaled against the strongest generator on
  // screen so the longest bar means "your biggest producer" rather than an
  // arbitrary cap that would leave every card looking equally full.
  const strongestRate = useGameStore((s) => {
    const per = s.transient.production.perGenerator;
    let max = 0;
    for (const id of Object.keys(per) as GeneratorId[]) {
      const v = Number(per[id].toString());
      if (Number.isFinite(v) && v > max) max = v;
    }
    return max;
  });
  const meterPct = strongestRate > 0 ? Math.min(100, (Number(rate.toString()) / strongestRate) * 100) : 0;

  return (
    <article
      className={`card generator-card ${affordable ? 'is-affordable' : ''} ${
        bought ? 'just-bought' : ''
      } ${justUnlocked ? 'just-unlocked' : ''}`}
    >
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

      <div
        className={`gen-meter ${Number(rate.toString()) > 0 ? '' : 'is-idle'}`}
        role="presentation"
      >
        <div className="gen-meter-fill" style={{ width: `${meterPct}%` }} />
      </div>

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
