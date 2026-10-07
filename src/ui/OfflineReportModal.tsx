/**
 * OfflineReportModal — "welcome back" summary.
 *
 * Driven by `offlineReport` in the store, which is set by `hydrate()` on load and
 * by `catchUp()` when a hidden tab comes back. The modal is informational: the
 * credits were already applied by the time it renders.
 */
import { useGameStore } from '../game/gameStore';
import { formatDecimal, formatDuration } from '../game/formulas';
import { BASE_OFFLINE_EFFICIENCY } from '../game/offline';
import { RESOURCE_LABELS } from '../game/types';

const RESOURCE_ORDER = ['cash', 'linesOfCode', 'coffee'] as const;

export function OfflineReportModal() {
  const report = useGameStore((s) => s.offlineReport);
  const dismiss = useGameStore((s) => s.dismissOfflineReport);

  if (!report || report.trivial) return null;

  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div className="modal-window" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>Welcome back</h2>
        </header>

        <section className="modal-body">
          <p className="modal-lede">
            You were away for <strong>{formatDuration(report.elapsedSeconds)}</strong>.
            {report.elapsedSeconds > report.cappedSeconds && (
              <> Offline production is capped at 8 hours.</>
            )}
          </p>
          <p>
            Credited at {Math.round(report.efficiency * 100)}% efficiency —{' '}
            <strong>{formatDuration(report.effectiveSeconds)}</strong> of production.
            {report.efficiency > BASE_OFFLINE_EFFICIENCY && (
              <> (raised from {Math.round(BASE_OFFLINE_EFFICIENCY * 100)}% by permanent upgrades.)</>
            )}
          </p>

          <ul className="offline-gains">
            {RESOURCE_ORDER.map((id) => {
              const gained = report.gained?.[id];
              if (!gained) return null;
              return (
                <li key={id}>
                  <span>{RESOURCE_LABELS[id]}</span>
                  <span>+{formatDecimal(gained)}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <footer className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={dismiss}>
            Back to work
          </button>
        </footer>
      </div>
    </div>
  );
}
