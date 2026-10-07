/**
 * UpgradesPanel — every purchasable upgrade, with an affordable-only filter.
 *
 * Upgrades whose requirements are not met yet are shown greyed out with the
 * reason attached, rather than hidden: in an idle game the visible next goal is
 * most of the fun.
 */
import { useState } from 'react';
import { UpgradeGrid } from '../components/UpgradeGrid';
import { useGameStore } from '../game/gameStore';
import { UPGRADE_DEFS } from '../game/upgrades';

export function UpgradesPanel() {
  const purchased = useGameStore((s) => s.gameState.upgrades.purchased);
  const [affordableOnly, setAffordableOnly] = useState(false);

  const remaining = UPGRADE_DEFS.filter((def) => !purchased.includes(def.id)).length;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Upgrades</h2>
        <div className="panel-actions">
          <span className="panel-note">
            {purchased.length}/{UPGRADE_DEFS.length} owned
            {remaining > 0 && ` · ${remaining} left`}
          </span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={affordableOnly}
              onChange={(event) => setAffordableOnly(event.target.checked)}
            />
            <span>Affordable only</span>
          </label>
        </div>
      </div>

      <UpgradeGrid showAffordableOnly={affordableOnly} />
    </section>
  );
}
