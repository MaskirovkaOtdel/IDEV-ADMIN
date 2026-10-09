/**
 * GeneratorCard — one generator: owned count, live production, next cost, buy.
 *
 * Selectors are deliberately primitive (Decimal / number / boolean) because the
 * store hands out a fresh state object every tick; selecting a derived object
 * would re-render forever.
 */
import { useMemo, useState } from 'react';
import type Decimal from 'break_infinity.js';
import type { GeneratorId } from '../game/types';
import { useGameStore, type BuyAmount } from '../game/gameStore';
import { GENERATOR_DEFS, requireGenDef } from '../game/generators';
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

/**
 * Percent for a meter label.
 *
 * `toFixed(1)` was wrong twice over. It printed "0.0%" for every card on a real
 * save, and it would print "100.0%" for a bar that is visibly full. Significant
 * figures instead: 0.0077% reads as "0.0077%", not as nothing.
 */
function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value > 0 && value < 0.01) return `${value.toPrecision(1)}%`;
  if (value >= 99.95) return '100%';
  return `${value.toFixed(1)}%`;
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
  const cashValue = useMemo(() => cashValueOf(def.produces, rate), [def.produces, rate]);

  // THE BAR: this generator's share of team output.
  //
  // FOUR TARGETS, THREE REJECTIONS
  // -------------------------------
  // This meter has been wrong three times, every time for the same reason: I picked
  // a target that reads well in principle and collapses against a real save.
  //
  //   v0.4.0  share of the strongest generator. A ratio, so a global multiplier
  //           scaled every card equally and moved nothing.
  //   v0.4.1  progress toward doubling income. Rendered "0.0%" on all seven cards
  //           of a real save -- income 3.23M/s against a best generator adding
  //           250/s, so one purchase was 0.0077% and 100% was 129x out of reach.
  //   v0.4.2  cash / cost of one more. Correct in the middle of the curve and
  //           pinned at 100% on all seven cards for a player 41x to 1080x past
  //           every cost. Just as useless as zero, in the other direction.
  //
  // The lesson is not "pick a better target". It is that a BAR must carry a
  // quantity which varies across the board at the player's actual scale.
  // Affordability fails for the rich; income-doubling fails for anyone whose income
  // comes mostly from stockpiles. Share of team output spans 0.2% to 85.6% on one
  // screen and never saturates, because it is bounded by construction -- the shares
  // sum to 100.
  //
  // Affordability still matters, so it moves to the hint text below. Text degrades
  // far better than a bar: "ready" versus "3 days away" still differs even when every
  // bar would read full.
  const teamSharePct = useGameStore((s) => {
    const per = s.transient.production.perGenerator;
    let total = 0;
    let mine = 0;
    for (const [id, value] of Object.entries(per)) {
      const def = GENERATOR_DEFS.find((d) => d.id === id);
      if (!def) continue;
      const worth = Number(cashValueOf(def.produces, value as Decimal).toString());
      if (!Number.isFinite(worth)) continue;
      total += worth;
      if (id === generatorId) mine = worth;
    }
    return total > 0 ? (mine / total) * 100 : 0;
  });

  const meterPct = teamSharePct;

  // THE HINT: how long the next hire takes to pay for itself.
  //
  // Seconds of current income to repay the purchase. It answers "is this one worth
  // it" more directly than either previous target, and unlike a bar it degrades
  // gracefully: "ready" versus "3 days away" still differ when every bar reads full.
  //
  // On the reviewed save this spans K8s Cluster at 1.2 days to Code Review at
  // 24,209 days -- which is the honest answer, and is exactly the fact the player
  // needs when deciding what to buy next.
  const payback = useMemo(() => {
    // Cost of ONE more, independent of the quantity toggle: the hint is about the
    // next hire, so switching to MAX must not change what it says.
    const nextCost = costForBulkPurchase(def.baseCost, growth, owned, 1, discount);
    if (owned <= 0 || nextCost.lessThanOrEqualTo(ZERO)) return null;
    const perUnit = cashValueOf(def.produces, rate.div(owned));
    if (perUnit.lessThanOrEqualTo(ZERO)) return null;
    const seconds = Number(nextCost.div(perUnit).toString());
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }, [def.baseCost, def.produces, discount, growth, owned, rate]);

  const paybackText = useMemo(() => {
    if (payback === null) return 'no output yet';
    if (payback < 60) return `pays back in ${Math.max(1, Math.round(payback))}s`;
    if (payback < 3600) return `pays back in ${Math.round(payback / 60)}m`;
    if (payback < 86_400) return `pays back in ${(payback / 3600).toFixed(1)}h`;
    return `pays back in ${(payback / 86_400).toFixed(1)} days`;
  }, [payback]);

  /** Affordable now, or how long until it is. */
  const affordabilityText = useMemo(
    () => (affordable ? 'ready to hire' : paybackText),
    [affordable, paybackText]
  );

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
        <span className="meter-label" title="Share of what your team produces">
          {cashValue.gt(ZERO) ? `${formatPercent(teamSharePct)} of team` : 'not producing'}
        </span>
      </div>
      <p className="meter-hint">{affordabilityText}</p>

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
