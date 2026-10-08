/**
 * PrestigePanel — Tech Debt balance, permanent upgrade tiers, reset button.
 *
 * Prestige pays out from lifetime cash (see prestige.ts for the curve). The panel
 * shows the payout *before* the player commits, plus what survives and what does
 * not, so the reset is never a surprise.
 */
import { useState } from 'react';
import { useGameStore } from '../game/gameStore';
import { PERM_UPGRADE_DEFS, permUpgradeCost } from '../game/permUpgrades';
import {
  canPrestige,
  computeTechDebtGained,
  lifetimeCashForTechDebt,
  runLifetimeCash,
  TECH_DEBT_EXPONENT,
  TECH_DEBT_FLOOR_LOG,
  TECH_DEBT_SCALE,
} from '../game/prestige';
import { formatDecimal } from '../game/formulas';
import { dec } from '../game/decimal';
import { SaveManager } from './SaveManager';

export interface PrestigePanelProps {
  onOpenResetModal: () => void;
}

/**
 * LifetimeCash beyond which a permanent upgrade counts as out of reach.
 *
 * Measured against the economy rather than guessed. The simulator reaches
 * 1e8 in an hour, 1e11 at six hours and 1e13 at 24h, so a player who keeps
 * coming back plausibly lands between 1e25 and 1e30 over the life of the game.
 *
 * Against the current curve, the required lifetimeCash spans:
 *
 *   1e6.3   Refactoring Grant      the first tier, ~46 minutes in
 *   1e13.9  AI Swarm License
 *   1e26.0  Infrastructure as Code
 *   1e58.2  Enterprise Contract    the dearest, a genuine end-game target
 *
 * 1e50 sits above every tier except the last, so it flags exactly one upgrade.
 * An earlier guess of 1e9 flagged 19 of 22 -- including things reachable at
 * 1e21 -- which would have mislabelled most of the pool as broken. The value
 * has to be read off that table, not picked for being large.
 *
 * This is a presentation distinction only. It never blocks a purchase; it just
 * stops an unaffordable upgrade and an impossible one looking identical.
 */
const UNREACHABLE_LIFETIME_CASH = 1e50;

/** True when no plausible lifetimeCash can ever pay this Tech Debt cost. */
function isUnreachableCost(cost: number): boolean {
  if (!Number.isFinite(cost) || cost <= 0) return false;
  const needed = lifetimeCashForTechDebt(cost);
  return needed.greaterThan(dec(UNREACHABLE_LIFETIME_CASH));
}

export function PrestigePanel({ onOpenResetModal }: PrestigePanelProps) {
  const gameState = useGameStore((s) => s.gameState);
  const buyPerm = useGameStore((s) => s.purchasePermUpgrade);

  const techDebt = gameState.prestige.techDebt;
  const payout = computeTechDebtGained(gameState);
  const eligible = canPrestige(gameState);
  const [saveOpen, setSaveOpen] = useState(false);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Prestige</h2>
        <span className="panel-note" data-testid="prestige-formula">
          Tech Debt formula: ⌊(log₁₀(unbanked cash) − {TECH_DEBT_FLOOR_LOG})^{TECH_DEBT_EXPONENT} ×{' '}
          {TECH_DEBT_SCALE}⌋
        </span>
      </div>

      <div className="prestige-summary">
        <div className="stat-box">
          <span className="stat-label">Tech Debt banked</span>
          <span className="stat-value">{formatDecimal(techDebt)}</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Reset would award</span>
          <span className={`stat-value ${eligible ? 'positive' : 'muted'}`}>
            {formatDecimal(payout)}
          </span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Unbanked cash this run</span>
          <span className="stat-value">{formatDecimal(runLifetimeCash(gameState))}</span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Resets so far</span>
          <span className="stat-value">{gameState.stats.prestigeCount}</span>
        </div>
      </div>

      <p className="prestige-hint">
        {eligible
          ? `Resetting wipes generators, upgrades and run resources. You have earned ${formatDecimal(
              runLifetimeCash(gameState)
            )} cash since your last reset, which banks as Tech Debt.`
          : `Lifetime cash only pays out for progress made since your last reset. The first tier needs ${formatDecimal(
              lifetimeCashForTechDebt(25)
            )} of it.`}
      </p>

      <button
        type="button"
        className="btn btn-danger"
        disabled={!eligible}
        onClick={onOpenResetModal}
      >
        Reset run for {formatDecimal(payout)} Tech Debt
      </button>

      <h3 className="sub-heading">Permanent upgrades</h3>
      <div className="card-grid">
        {PERM_UPGRADE_DEFS.map((def) => {
          const owned = gameState.prestige.permanentUpgrades[def.id] ?? 0;
          const cost = permUpgradeCost(gameState, def.id);
          const affordable = cost ? techDebt.greaterThanOrEqualTo(cost) : false;

          // Distinguish "not yet" from "out of reach".
          //
          // Both used to render as the same dimmed card, so a permanent upgrade
          // costing more than the payout curve can ever earn looked identical to
          // one you simply had not saved for yet. Those are different problems
          // for the player, and conflating them is how ten unreachable upgrades
          // went unnoticed. `is-unreachable` is only applied once the required
          // lifetimeCash exceeds anything the curve can pay.
          const unreachable =
            !affordable && isUnreachableCost(def.baseCost.toNumber());

          return (
            <article
              key={def.id}
              className={`card perm-card ${affordable ? 'is-affordable' : unreachable ? 'is-unreachable' : 'is-locked'}`}
            >
              <header className="card-header">
                <div className="card-heading">
                  <h4 className="card-title">{def.name}</h4>
                  <p className="card-flavor">{def.description}</p>
                </div>
                <span className="owned-badge">×{owned}</span>
              </header>

              <button
                type="button"
                className="btn btn-secondary"
                disabled={!affordable || !cost}
                onClick={() => buyPerm(def.id)}
              >
                {cost ? `${formatDecimal(cost)} Tech Debt` : 'Unavailable'}
              </button>
              <p className="card-error">
                Next level costs ×{def.costMultiplier} more
              </p>
            </article>
          );
        })}
      </div>
      <p className="panel-note">
        Every permanent upgrade is repeatable. Cost scales by its own multiplier per level, so
        the cheapest tier stays worth buying between prestiges.
      </p>

      <div className="panel-footer-row">
        <button type="button" className="btn btn-ghost" onClick={() => setSaveOpen(true)}>
          Export / import save
        </button>
      </div>

      <SaveManager isOpen={saveOpen} onClose={() => setSaveOpen(false)} />
    </section>
  );
}
