/**
 * GeneratorsPanel — the hire screen.
 *
 * Only unlocked generators are listed; the panel nudges toward the next unlock
 * threshold so the player always knows what to aim for.
 */
import { useMemo } from 'react';
import { GeneratorCard } from '../components/GeneratorCard';
import { EmptyState } from './EmptyState';
import { useGameStore } from '../game/gameStore';
import { GENERATOR_DEFS } from '../game/generators';
import { formatDecimal } from '../game/formulas';

export function GeneratorsPanel() {
  const generators = useGameStore((s) => s.gameState.generators);
  const lifetimeCash = useGameStore((s) => s.gameState.resources.lifetimeCash);

  const { unlocked, nextLocked } = useMemo(() => {
    const unlockedIds = GENERATOR_DEFS.filter((def) => generators[def.id].unlocked);
    const lockedIds = GENERATOR_DEFS.filter((def) => !generators[def.id].unlocked);
    const upcoming = lockedIds.find((def) =>
      lifetimeCash.greaterThanOrEqualTo(def.unlockAt.lifetimeCash)
    );
    return { unlocked: unlockedIds, nextLocked: upcoming ?? lockedIds[0] };
  }, [generators, lifetimeCash]);

  const totalOwned = useMemo(
    () => GENERATOR_DEFS.reduce((sum, def) => sum + (generators[def.id]?.owned ?? 0), 0),
    [generators]
  );

  if (totalOwned === 0 && lifetimeCash.lessThan(15)) {
    return (
      <EmptyState
        message="Nothing but an empty repo. Hire your first Junior Dev to get the build passing."
      />
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Generators</h2>
        <span className="panel-note">
          {totalOwned} owned
          {nextLocked && !generators[nextLocked.id].unlocked && (
            <> · next unlock: {nextLocked.name} at {formatDecimal(nextLocked.unlockAt.lifetimeCash)} lifetime cash</>
          )}
        </span>
      </div>

      <div className="card-grid">
        {unlocked.map((def) => (
          <GeneratorCard key={def.id} generatorId={def.id} />
        ))}
      </div>
    </section>
  );
}
