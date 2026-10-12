/**
 * AchievementsPanel — the list of goals, and how far away each one is.
 *
 * WHY EVERY LOCKED ROW SHOWS ITS ARITHMETIC
 * -----------------------------------------
 * A grid of greyed-out achievements is the same problem as the empty Upgrades
 * panel in v0.5.0: "Nothing to buy here right now" in a screen-height void. The
 * fix there was to show the next three things and the specific thing each needed,
 * and the same reasoning applies here.
 *
 * So a locked row reads `4 / 25`, not just a dimmed icon. The fraction comes from
 * `progressFraction`, which is derived from the same `measure` that decides
 * whether the achievement unlocks -- so the number on a locked row and the moment
 * it turns earned cannot disagree.
 *
 * Sorting puts the nearest-at-the-top: progress fraction, descending. That makes
 * the panel answer "what should I do next" without the player doing arithmetic,
 * while leaving every achievement visible rather than hiding the far ones.
 */
import type { GameState } from '../game/types';
import { useGameStore } from '../game/gameStore';
import {
  ACHIEVEMENTS,
  progressFraction,
  unlockedCount,
  type AchievementDef,
} from '../game/achievements';
import { formatDecimal } from '../game/formulas';

const TIER_LABELS: Record<number, string> = {
  1: 'Getting started',
  2: 'Building a team',
  3: 'Scale',
  4: 'After the reset',
};

export function AchievementsPanel() {
  const state = useGameStore((s) => s.gameState);
  const earned = unlockedCount(state.achievements);
  const total = ACHIEVEMENTS.length;

  // Locked first by proximity, so the panel reads as a to-do list. Earned keep
  // their definition order, which groups them with the tier they belong to.
  const ordered = [...ACHIEVEMENTS].sort((a, b) => {
    const ea = isEarned(a, state.achievements);
    const eb = isEarned(b, state.achievements);
    if (ea !== eb) return ea ? 1 : -1;
    if (ea) return a.tier - b.tier || ACHIEVEMENTS.indexOf(a) - ACHIEVEMENTS.indexOf(b);
    return progressFraction(b, state) - progressFraction(a, state);
  });

  return (
    <section className="panel achievements-panel" aria-labelledby="achievements-heading">
      <header className="panel-head">
        <h2 id="achievements-heading">Achievements</h2>
        <p className="panel-sub">
          Milestones, not rewards — none of these change a number you earn. They
          just remember what you did.
        </p>
      </header>

      <div className="achievement-count">
        <strong>{earned}</strong>
        <span> / {total} earned</span>
        <div
          className="achievement-count-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={earned}
          aria-label="Achievements earned"
        >
          <span
            className="achievement-count-fill"
            style={{ width: `${total > 0 ? (earned / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {[1, 2, 3, 4].map((tier) => {
        const group = ordered.filter((a) => a.tier === tier);
        if (group.length === 0) return null;
        return (
          <div key={tier} className="achievement-tier">
            <h3 className="achievement-tier-title">{TIER_LABELS[tier]}</h3>
            <ul className="achievement-list">
              {group.map((def) => (
                <AchievementRow key={def.id} def={def} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function isEarned(def: AchievementDef, record: Record<string, number>): boolean {
  return record[def.id] !== undefined;
}

function AchievementRow({ def }: { def: AchievementDef }) {
  const state = useGameStore((s) => s.gameState);
  const earned = isEarned(def, state.achievements);
  const fraction = progressFraction(def, state);
  const percent = Math.round(fraction * 100);

  return (
    <li className={`achievement ${earned ? 'is-earned' : ''}`}>
      <span className="achievement-icon" aria-hidden="true">
        {def.icon}
      </span>
      <div className="achievement-body">
        <div className="achievement-title">
          <strong>{def.name}</strong>
          {/* The status is in text, not only in colour — a dimmed row and a lit
              row must be distinguishable without sight.

              The sr-only prefix carries the word the visible text omits. Earned
              rows already show the word, so prefixing it produced "Earned. Earned"
              in the accessibility tree and read that way aloud. Locked rows show
              only a percentage, so there the prefix is the only thing stating that
              the row is not yet earned. */}
          <span className="achievement-status">
            {earned ? (
              'Earned'
            ) : (
              <>
                <span className="sr-only">Locked. </span>
                {percent}% — {formatProgress(def, state)}
              </>
            )}
          </span>
        </div>
        <p className="achievement-desc">{def.description}</p>
        {!earned && (
          <div
            className="achievement-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={`${def.name} progress`}
          >
            <span className="achievement-bar-fill" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
    </li>
  );
}

/** `4 / 25`. Two significant figures, so a lifetime total cannot widen the row. */
function formatProgress(def: AchievementDef, state: GameState): string {
  return `${formatDecimal(def.measure(state), 2)} / ${formatDecimal(def.target, 2)}`;
}