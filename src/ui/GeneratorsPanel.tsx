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

/**
 * Gap between arrivals, in ms.
 *
 * Two cards animating together read as one event; staggered they read as two
 * separate hires, which is what actually happened. 220ms is long enough to
 * register individually and short enough that a three-generator return still
 * finishes before the player has decided what to click.
 */
const ARRIVAL_STAGGER_MS = 220;

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
  // TWO SOURCES, AND THE DIFFERENCE MATTERS
  // ---------------------------------------
  // 1. `pendingArrivals` from the store: generators that the *offline walk*
  //    unlocked while the player was away. The store is the only place that can
  //    know this, because both the before and after states exist there and
  //    nowhere else.
  // 2. A live diff below: a generator unlocking while the tab is open.
  //
  // Both are needed. The store alone misses live unlocks; the live diff alone is
  // blind on load, because by mount time offline-unlocked generators are simply
  // unlocked and indistinguishable from ones restored from the save. An earlier
  // version used only the diff and suppressed its first pass, which meant a
  // player returning after sixteen hours saw no arrival animation at all -- the
  // exact case the animation exists for.
  const pendingArrivals = useGameStore((s) => s.pendingArrivals);
  const clearPendingArrivals = useGameStore((s) => s.clearPendingArrivals);
  const offlineReportOpen = useGameStore((s) => s.offlineReport !== null);

  const [arrived, setArrived] = useState<ReadonlySet<string>>(EMPTY_SET);
  const previousUnlocked = useRef<ReadonlySet<string>>(EMPTY_SET);

  // Live unlocks while the tab is open.
  useEffect(() => {
    const current = new Set(
      GENERATOR_DEFS.filter((def) => generators[def.id].unlocked).map((def) => def.id)
    );

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

    // Deferred to a microtask rather than set synchronously here. Calling
    // setState inside an effect body triggers a second render pass in the same
    // commit, which React flags as a cascading render and which would make the
    // game tick loop do double work at exactly the moment a generator unlocks.
    if (fresh.size > 0) {
      queueMicrotask(() => setArrived((prev) => new Set([...prev, ...fresh])));
    }
  }, [generators]);

  // Offline arrivals, played only once the modal is gone.
  //
  // Animating cards behind a modal achieves nothing: the player cannot see them,
  // and dismissing the summary reveals cards that have already finished
  // animating. So the arrivals wait for the dismissal, which is also the moment
  // the player starts looking at the screen. The modal names who arrived, so
  // dismissal is an invitation to go and look rather than a dismissal of nothing.
  useEffect(() => {
    if (pendingArrivals.length === 0 || offlineReportOpen) return;

    // Staggered so two arrivals read as two hires rather than one event. The
    // queue is walked with one timer per card; clearing them all on cleanup stops
    // a mid-sequence unmount from leaving stragglers to fire into a dead tree.
    const timers = pendingArrivals.map((id, index) =>
      setTimeout(() => setArrived((prev) => new Set([...prev, id])), index * ARRIVAL_STAGGER_MS)
    );

    const settle = setTimeout(
      () => clearPendingArrivals(),
      pendingArrivals.length * ARRIVAL_STAGGER_MS + 900
    );

    return () => {
      for (const timer of timers) clearTimeout(timer);
      clearTimeout(settle);
    };
  }, [pendingArrivals, offlineReportOpen, clearPendingArrivals]);

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
        {unlocked
          .slice()
          .sort((a, b) => Number(arrived.has(a.id)) - Number(arrived.has(b.id)))
          .map((def) => (
            <GeneratorCard key={def.id} generatorId={def.id} justArrived={arrived.has(def.id)} />
          ))}
      </div>
    </section>
  );
}
