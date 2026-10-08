/**
 * GeneratorsPanel — the hire screen.
 *
 * Only unlocked generators are listed; the panel nudges toward the next unlock
 * threshold so the player always knows what to aim for.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { GeneratorCard } from '../components/GeneratorCard';
import { EmptyState } from './EmptyState';
import { useGameStore } from '../game/gameStore';
import { GENERATOR_DEFS, requireGenDef } from '../game/generators';
import { formatDecimal } from '../game/formulas';

/** Stable empty set, so identity does not change on every render. */
const EMPTY_SET: ReadonlySet<string> = new Set<string>();

export function GeneratorsPanel() {
  const generators = useGameStore((s) => s.gameState.generators);
  const lifetimeCash = useGameStore((s) => s.gameState.resources.lifetimeCash);
  const cash = useGameStore((s) => s.gameState.resources.cash);

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

  // Which generators have just become available, for the arrival animation.
  //
  // WHY THIS LIVES HERE AND NOT IN THE CARD
  // ----------------------------------------
  // GeneratorCard used to watch its own `unlocked` flag for the change. That could
  // never fire: this panel renders unlocked generators only, so a card does not
  // exist while its generator is locked. By the time the card mounts the flag is
  // already true, and a change-from-false watcher sees only its first value. The
  // animation shipped as dead code and went unnoticed because headless testing
  // suppresses motion entirely.
  //
  // The panel is the only place that can tell "this generator just arrived" from
  // "this generator has been here since you loaded", because it is the component
  // that holds both the current and previous unlocked sets.
  const [arrived, setArrived] = useState<ReadonlySet<string>>(EMPTY_SET);
  const previousUnlocked = useRef<ReadonlySet<string>>(EMPTY_SET);

  useEffect(() => {
    const current = new Set(
      GENERATOR_DEFS.filter((def) => generators[def.id].unlocked).map((def) => def.id)
    );

    // On the first pass there is no previous set to compare against, so nothing
    // counts as an arrival. A player loading a mid-game save should not be shown
    // six unlock animations for generators unlocked hours ago.
    const isFirstPass = previousUnlocked.current.size === 0;
    const fresh = new Set<string>();
    if (!isFirstPass) {
      for (const id of current) {
        if (!previousUnlocked.current.has(id)) fresh.add(id);
      }
    }

    // Update the baseline before anything that can return, so an early exit
    // cannot leave the previous set stale and corrupt the next comparison.
    previousUnlocked.current = current;

    if (fresh.size > 0) setArrived(fresh);
  }, [generators]);

  // Clear the flag once the animation has played, so a card does not replay it on
  // an unrelated re-render.
  useEffect(() => {
    if (arrived.size === 0) return;
    const timer = setTimeout(() => setArrived(EMPTY_SET), 900);
    return () => clearTimeout(timer);
  }, [arrived]);

  // Show the empty state only until the first hire is affordable — a fresh game
  // starts with cash, so gating on lifetime cash alone hid the cards.
  if (totalOwned === 0 && cash.lessThan(requireGenDef('juniorDev').baseCost)) {
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
          <GeneratorCard key={def.id} generatorId={def.id} justArrived={arrived.has(def.id)} />
        ))}
      </div>
    </section>
  );
}
