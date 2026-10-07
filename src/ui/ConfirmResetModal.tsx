/**
 * ConfirmResetModal — the "are you sure" before a prestige reset.
 *
 * Explicitly lists what is kept and what is wiped, because a prestige that eats
 * an afternoon of progress needs to be a conscious decision.
 */
import { useGameStore } from '../game/gameStore';
import {
  computeTechDebtGained,
  estimatePrestigeMilestones,
  lifetimeCashForTechDebt,
  runLifetimeCash,
} from '../game/prestige';
import { PERM_UPGRADE_DEFS } from '../game/permUpgrades';
import { formatDecimal } from '../game/formulas';

export interface ConfirmResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmResetModal({ isOpen, onClose, onConfirm }: ConfirmResetModalProps) {
  const gameState = useGameStore((s) => s.gameState);
  const lifetimeCash = gameState.resources.lifetimeCash;
  const prestige = gameState.prestige;
  const permOwned = prestige.permanentUpgrades;

  // Payout is computed from cash earned *since the last reset*, never the raw
  // lifetime total — otherwise a reset would let the player re-claim the same
  // Tech Debt indefinitely.
  const unbanked = runLifetimeCash(gameState);
  const payout = computeTechDebtGained(gameState);
  const nextTierAt = lifetimeCashForTechDebt(
    Number(PERM_UPGRADE_DEFS[0].baseCost.toString())
  );

  if (!isOpen) return null;

  const permCount = Object.values(permOwned).reduce((sum, n) => sum + n, 0);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-window" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>Reset the run?</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <section className="modal-body">
          <p className="modal-lede">
            You will bank <strong>{formatDecimal(payout)} Tech Debt</strong> (total{' '}
            {formatDecimal(prestige.techDebt.plus(payout))}).
          </p>

          <div className="two-col">
            <div>
              <h4 className="keep">Kept</h4>
              <ul>
                <li>Lifetime cash ({formatDecimal(lifetimeCash)})</li>
                <li>Permanent upgrades ({permCount} owned)</li>
                <li>Lifetime stats</li>
                <li>Best run record</li>
              </ul>
            </div>
            <div>
              <h4 className="wipe">Wiped</h4>
              <ul>
                <li>All generators</li>
                <li>All run upgrades</li>
                <li>Cash, LoC and coffee stocks</li>
                <li>Run playtime</li>
              </ul>
            </div>
          </div>

          <details className="curve-details">
            <summary>Prestige curve reference</summary>
            <table>
              <thead>
                <tr>
                  <th>Lifetime cash</th>
                  <th>Tech Debt</th>
                </tr>
              </thead>
              <tbody>
                {estimatePrestigeMilestones().map((row) => (
                  <tr key={row.lifetimeCash}>
                    <td>{row.lifetimeCash}</td>
                    <td>{row.techDebt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>

          <div className="baseline-note">
            <p>
              Only cash earned <strong>since your last reset</strong> pays out:{' '}
              <strong>{formatDecimal(unbanked)}</strong> of {formatDecimal(lifetimeCash)}{' '}
              lifetime cash is still unbanked.
            </p>
            <p>
              The first permanent tier needs {formatDecimal(nextTierAt)} of unbanked
              cash. Resetting again with no new progress would award nothing.
            </p>
          </div>
        </section>

        <footer className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            Prestige
          </button>
        </footer>
      </div>
    </div>
  );
}
