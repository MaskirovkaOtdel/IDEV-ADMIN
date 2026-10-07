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
} from '../game/prestige';
import { formatDecimal } from '../game/formulas';
import { SaveManager } from './SaveManager';

export interface PrestigePanelProps {
  onOpenResetModal: () => void;
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
        <span className="panel-note">
          Tech Debt formula: ⌊(log₁₀(unbanked cash) − 3)^1.6 × 6⌋
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

          return (
            <article key={def.id} className={`card perm-card ${affordable ? 'is-affordable' : 'is-locked'}`}>
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

      <div className="panel-footer-row">
        <button type="button" className="btn btn-ghost" onClick={() => setSaveOpen(true)}>
          Export / import save
        </button>
      </div>

      <SaveManager isOpen={saveOpen} onClose={() => setSaveOpen(false)} />
    </section>
  );
}
