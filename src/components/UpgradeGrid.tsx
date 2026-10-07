/**
 * UpgradeGrid — the list of upgrades, optionally filtered to affordable ones.
 */
import { useGameStore } from '../game/gameStore';
import { UPGRADE_DEFS } from '../game/upgrades';
import { UpgradeCard } from './UpgradeCard';

export interface UpgradeGridProps {
  /** Optional filter: only show upgrades that can be afforded right now */
  showAffordableOnly?: boolean;
}

export function UpgradeGrid({ showAffordableOnly = false }: UpgradeGridProps) {
  const gameState = useGameStore((s) => s.gameState);

  const visible = UPGRADE_DEFS.filter((def) => {
    if (gameState.upgrades.purchased.includes(def.id)) return false;
    if (!showAffordableOnly) return true;
    return gameState.resources[def.cost.resource].greaterThanOrEqualTo(def.cost.amount);
  });

  if (visible.length === 0) {
    return <p className="empty-note">Nothing to buy here right now.</p>;
  }

  return (
    <div className="card-grid">
      {visible.map((def) => (
        <UpgradeCard key={def.id} upgradeId={def.id} def={def} />
      ))}
    </div>
  );
}
