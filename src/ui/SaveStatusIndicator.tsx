/**
 * SaveStatusIndicator — where the autosave heartbeat currently stands.
 *
 * Reads the store's save status instead of guessing (the previous version
 * reported "Saving…" forever once a tick had happened).
 */
import { useGameStore } from '../game/gameStore';

export function SaveStatusIndicator() {
  const status = useGameStore((s) => s.transient.save.status);
  const lastSavedAt = useGameStore((s) => s.transient.save.lastSavedAt);

  const text =
    status === 'error'
      ? 'Save failed — storage unavailable'
      : status === 'saving'
        ? 'Saving…'
        : lastSavedAt
          ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
          : 'Not saved yet';

  return (
    <div className={`save-status save-status-${status}`}>
      <span className="save-dot" aria-hidden="true" />
      <span className="save-status-text">{text}</span>
    </div>
  );
}
