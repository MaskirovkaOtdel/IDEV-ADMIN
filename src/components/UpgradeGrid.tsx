/**
 * UpgradeGrid — the list of upgrades, optionally filtered to affordable ones.
 *
 * Always-available upgrades render as cards. Once everything is bought, or the
 * player filters to what they can afford right now, the nearest few LOCKED
 * upgrades are shown as a preview instead of an empty panel.
 *
 * That last part is the reason this is a component rather than a filter on a map.
 * With 12 upgrades the panel read "Nothing to buy here right now" and stayed
 * there: a screen-height void with no forward visibility at all, in a game whose
 * whole appeal is deciding what to work towards next. Showing the nearest three
 * keeps a goal on screen without filling the page with greyed-out rows.
 */
import { useGameStore } from '../game/gameStore';
import { UPGRADE_DEFS } from '../game/upgrades';
import { canAffordUpgrade, meetsUpgradeRequirements } from '../game/conditions';
import { formatDecimal } from '../game/formulas';
import { RESOURCE_UNITS } from '../game/labels';
import { dec } from '../game/decimal';
import { UpgradeCard } from './UpgradeCard';

/** How many upcoming upgrades to preview when there is nothing to buy. */
export const LOCKED_PREVIEW_COUNT = 3;

export interface UpgradeGridProps {
  /** Optional filter: only show upgrades that can be afforded right now */
  showAffordableOnly?: boolean;
}

export function UpgradeGrid({ showAffordableOnly = false }: UpgradeGridProps) {
  const gameState = useGameStore((s) => s.gameState);

  const unpurchased = UPGRADE_DEFS.filter((def) => !gameState.upgrades.purchased.includes(def.id));

  const buyable = unpurchased.filter((def) => canAffordUpgrade(gameState, def));
  const locked = unpurchased.filter((def) => !canAffordUpgrade(gameState, def));

  const visible = showAffordableOnly ? buyable : unpurchased;

  if (visible.length === 0) {
    // Everything is bought, or the filter hid everything. Show the nearest locked
    // upgrades so the panel still answers "what next?" rather than shrugging.
    const preview = locked.slice(0, LOCKED_PREVIEW_COUNT);
    if (preview.length === 0) {
      return (
        <p className="empty-note">
          Every upgrade is yours. Burn the run for Tech Debt to unlock the permanent tree.
        </p>
      );
    }
    return (
      <>
        <p className="empty-note">
          {showAffordableOnly
            ? 'Nothing affordable right now. Coming up:'
            : 'Everything bought. Up next:'}
        </p>
        <div className="card-grid">
          {preview.map((def) => (
            <LockedUpgradeRow key={def.id} def={def} />
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="card-grid">
      {visible.map((def) => (
        <UpgradeCard key={def.id} upgradeId={def.id} def={def} />
      ))}
    </div>
  );
}

/**
 * A not-yet-affordable upgrade, with the specific reason.
 *
 * Reuses `meetsUpgradeRequirements` for the gate copy rather than restating it,
 * so the two can never disagree about why something is locked.
 */
function LockedUpgradeRow({ def }: { def: (typeof UPGRADE_DEFS)[number] }) {
  const gameState = useGameStore((s) => s.gameState);
  const requirement = meetsUpgradeRequirements(gameState, def);
  const have = gameState.resources[def.cost.resource];
  const pct = have.lessThanOrEqualTo(dec(0))
    ? 0
    : Math.min(100, Number(have.div(def.cost.amount).mul(100).toString()));

  return (
    // `upgrade-preview` is distinct from `is-locked`, which UpgradeCard already
    // applies to any upgrade whose requirements are unmet. Colliding on one class
    // made the two indistinguishable in the DOM, and the first version of the
    // tests could not tell a preview row from a normal card.
    <article className="card upgrade-card is-locked upgrade-preview">
      <header className="card-header">
        <span className="card-icon" aria-hidden="true">
          🔒
        </span>
        <div className="card-heading">
          <h3 className="card-title">{def.name}</h3>
          <p className="card-flavor">{def.description}</p>
        </div>
      </header>

      <div className="gen-meter" role="presentation">
        <div className="gen-meter-fill" style={{ width: `${pct.toFixed(1)}%` }} />
      </div>

      <p className="upgrade-locked-reason">
        {requirement.met ? null : requirement.reason}
        {requirement.met && (
          <>
            Needs {formatDecimal(def.cost.amount)} {RESOURCE_UNITS[def.cost.resource]} — you have{' '}
            {formatDecimal(have)}
          </>
        )}
      </p>
    </article>
  );
}
