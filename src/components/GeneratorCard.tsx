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
import {
  cashValueOf,
  costForBulkPurchase,
  effectiveCostGrowth,
  formatDecimal,
  maxAffordable,
} from '../game/formulas';
import { ZERO } from '../game/decimal';
import { BuyAmountToggle } from './BuyAmountToggle';
import { RESOURCE_UNITS } from '../game/labels';
import { usePulse } from '../game/useFlash';

export interface GeneratorCardProps {
  generatorId: GeneratorId;
  /**
   * True for a moment after this generator becomes available, so the arrival
   * animation plays.
   *
   * Passed in rather than detected here on purpose. This card only renders for
   * unlocked generators, so its own `unlocked` flag is true from the moment it
   * mounts and never changes afterwards -- a self-contained watcher can never
   * observe the transition. GeneratorsPanel owns the previous unlocked set, which
   * is the only place that can tell a fresh arrival from a restored save.
   */
  justArrived?: boolean;
}

export function GeneratorCard({ generatorId, justArrived = false }: GeneratorCardProps) {
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

  // The meter shows this generator's share of your income.
  //
  // Two corrections over the version that shipped in v0.4.0, which was wrong in
  // a way that looked plausible.
  //
  // 1. VALUE, NOT MAGNITUDE. It divided raw rates against each other, so
  //    `24.75 LoC/s` was compared directly with `26.4 cash/s`. On a real save
  //    that gave Code Review a bar at 94% while it contributed under 3% of actual
  //    income -- LoC converts at 0.05 and Coffee at 0.35. Everything is now
  //    converted to cash first, so the bar means "how much of your money this
  //    makes".
  //
  // 2. ABSOLUTE, NOT RELATIVE. It was scaled against the strongest generator on
  //    screen, which made the bar a pure ratio: a global multiplier scales every
  //    card equally, so buying an upgrade moved nothing at all. That is what made
  //    the meter look broken after a purchase -- the numbers rose and the bars
  //    did not. The bar is now progress toward a real target, so filling it means
  //    something and an upgrade visibly pushes it.
  const cashValue = useMemo(() => cashValueOf(def.produces, rate), [def.produces, rate]);

  // What one more unit of this generator adds to income.
  //
  // Derived by dividing the live rate by the owned count rather than rebuilding
  // the multiplier stack: `rate` is already `baseRate * owned * mult`, so the
  // quotient is the per-unit rate with every multiplier applied. Reconstructing
  // the multipliers separately would mean duplicating the engine's multiplication
  // order and hoping the two stay in step.
  const perUnitCash = useMemo(
    () => (owned > 0 ? cashValueOf(def.produces, rate.div(owned)) : ZERO),
    [def.produces, owned, rate]
  );

  const incomePerSec = useGameStore((s) => s.transient.production.cashPerSec);

  // Progress toward a doubling: 100% means buying one more would double income.
  //
  // An absolute target rather than a comparison to the best card, so a global
  // multiplier moves every bar instead of leaving them all fixed. Doubling is the
  // threshold because it holds meaning at every scale -- early game it is seconds
  // away, late game it is hours, and the bar stays honest throughout.
  const secondsToDouble = useMemo(() => {
    if (perUnitCash.lessThanOrEqualTo(ZERO) || incomePerSec.lessThanOrEqualTo(ZERO)) return 0;
    const ratio = Number(incomePerSec.div(perUnitCash).toString());
    return Number.isFinite(ratio) ? ratio : 0;
  }, [incomePerSec, perUnitCash]);

  const meterPct = secondsToDouble > 0 ? Math.min(100, (1 / secondsToDouble) * 100) : 0;

  return (
    <article
      className={`card generator-card ${affordable ? 'is-affordable' : ''} ${
        bought ? 'just-bought' : ''
      } ${justArrived ? 'just-unlocked' : ''}`}
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

      <div className="meter-row">
        <div className={`gen-meter ${cashValue.gt(ZERO) ? '' : 'is-idle'}`} role="presentation">
          <div className="gen-meter-fill" style={{ width: `${meterPct}%` }} />
        </div>
        <span className="meter-label">
          {cashValue.gt(ZERO) ? `${meterPct.toFixed(1)}% to 2× income` : 'idle'}
        </span>
      </div>

      <dl className="card-stats">
        <div>
          <dt>Production</dt>
          <dd>
            {formatDecimal(rate)} {RESOURCE_UNITS[def.produces]}/s
            {/* LoC and Coffee bill out as cash, so the conversion is shown rather
                than left for the player to infer. Without it the meter appears to
                disagree with the number directly above it. */}
            {def.produces !== 'cash' && (
              <span className="stat-aside"> = {formatDecimal(cashValue)} cash/s</span>
            )}
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
