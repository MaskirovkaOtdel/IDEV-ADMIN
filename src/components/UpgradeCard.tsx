/**
 * UpgradeCard — one upgrade with its cost, gates and effect summary.
 *
 * The card asks the same helpers the store uses (`meetsUpgradeRequirements`,
 * `canAffordUpgrade`) whether the purchase is legal, so the button state and the
 * action can never disagree.
 */
import type { UpgradeDef, UpgradeId } from '../game/types';
import { useGameStore } from '../game/gameStore';
import { upgradeDef } from '../game/upgrades';
import { canAffordUpgrade, meetsUpgradeRequirements } from '../game/conditions';
import { formatDecimal } from '../game/formulas';
import { RESOURCE_LABELS } from '../game/types';

export interface UpgradeCardProps {
  upgradeId: UpgradeId;
  def?: UpgradeDef;
}

export function UpgradeCard({ upgradeId, def: providedDef }: UpgradeCardProps) {
  const def = providedDef ?? upgradeDef(upgradeId);
  const gameState = useGameStore((s) => s.gameState);
  const buy = useGameStore((s) => s.purchaseUpgrade);

  if (!def) return null;

  const purchased = gameState.upgrades.purchased.includes(upgradeId);
  const requirements = meetsUpgradeRequirements(gameState, def);
  const affordable = canAffordUpgrade(gameState, def);
  const canPurchase = !purchased && requirements.met && affordable;

  const effectSummary = def.effects
    .map((effect) => {
      switch (effect.kind) {
        case 'globalMult':
          return `all production ×${effect.value}`;
        case 'resourceMult':
          return `${effect.target} ×${effect.value}`;
        case 'generatorMult':
          return `${effect.target} ×${effect.value}`;
        case 'revenueMult':
          return `revenue ×${effect.value}`;
        case 'costDiscount':
          return `costs ×${effect.value}`;
        case 'costGrowthDelta':
          return `cost growth ${effect.value > 0 ? '+' : ''}${effect.value}`;
      }
    })
    .join(' · ');

  return (
    <article
      className={`card upgrade-card ${purchased ? 'is-owned' : canPurchase ? 'is-affordable' : 'is-locked'}`}
    >
      <header className="card-header">
        <div className="card-heading">
          <h3 className="card-title">{def.name}</h3>
          <p className="card-flavor">{def.description}</p>
        </div>
        <span className={`badge badge-${purchased ? 'owned' : canPurchase ? 'ready' : 'locked'}`}>
          {purchased ? 'Owned' : canPurchase ? 'Buy' : 'Locked'}
        </span>
      </header>

      <p className="effect-line">→ {effectSummary}</p>

      <button
        type="button"
        className="btn btn-secondary"
        disabled={!canPurchase}
        onClick={() => buy(upgradeId)}
      >
        {formatDecimal(def.cost.amount)} {RESOURCE_LABELS[def.cost.resource]}
      </button>

      {!requirements.met && requirements.reason && (
        <p className="card-error">{requirements.reason}</p>
      )}
      {!purchased && requirements.met && !affordable && (
        <p className="card-error">
          Need {formatDecimal(def.cost.amount)} {RESOURCE_LABELS[def.cost.resource]}
        </p>
      )}
    </article>
  );
}
