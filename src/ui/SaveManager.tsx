/**
 * SaveManager — export and import a save as text.
 *
 * Why this exists: progress lives in `localStorage`, which is per-browser and
 * per-origin. Playing on a laptop and on a phone means two unrelated games with
 * two unrelated progresses, and there is no sync. Copying the save string is the
 * cheapest thing that makes the game portable between devices without
 * introducing accounts, a server, or any data leaving the browser.
 *
 * Import is validated by the store before it touches live state, so a bad paste
 * cannot corrupt an existing save.
 */
import { useState } from 'react';
import { useGameStore } from '../game/gameStore';
import { formatDuration } from '../game/formulas';

export interface SaveManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SaveManager({ isOpen, onClose }: SaveManagerProps) {
  const exportSave = useGameStore((s) => s.exportSave);
  const loadFromString = useGameStore((s) => s.loadFromString);
  const save = useGameStore((s) => s.save);
  const gameState = useGameStore((s) => s.gameState);

  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  if (!isOpen) return null;

  const current = exportSave();
  const owned = Object.values(gameState.generators).reduce((sum, g) => sum + g.owned, 0);
  const permOwned = Object.values(gameState.prestige.permanentUpgrades).reduce((a, b) => a + b, 0);

  const copy = () => {
    if (!current) return;
    void navigator.clipboard?.writeText(current).then(
      () => setStatus({ tone: 'ok', text: 'Copied. Paste it into the import box on your other device.' }),
      () => setStatus({ tone: 'error', text: 'Clipboard blocked by the browser — select the text and copy manually.' })
    );
  };

  const importDraft = () => {
    const result = loadFromString(draft.trim());
    if (result.ok) {
      setStatus({ tone: 'ok', text: 'Save imported.' });
      setDraft('');
      save();
    } else {
      setStatus({ tone: 'error', text: `Import failed: ${result.error ?? 'unknown reason'}` });
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal-window" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>Save data</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <section className="modal-body">
          <p className="modal-lede">
            Progress is stored in this browser only. Export to move it to another device,
            or to keep a backup.
          </p>

          <dl className="save-summary">
            <div>
              <dt>Playtime</dt>
              <dd>{formatDuration(gameState.stats.playSeconds)}</dd>
            </div>
            <div>
              <dt>Prestiges</dt>
              <dd>{gameState.stats.prestigeCount}</dd>
            </div>
            <div>
              <dt>Generators</dt>
              <dd>{owned}</dd>
            </div>
            <div>
              <dt>Permanent</dt>
              <dd>{permOwned}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{current ? `${(current.length / 1024).toFixed(1)} kB` : '—'}</dd>
            </div>
          </dl>

          <div className="save-block">
            <div className="save-block-header">
              <h3>Export</h3>
              <button type="button" className="btn btn-secondary" onClick={copy}>
                Copy to clipboard
              </button>
            </div>
            <textarea
              className="save-textarea"
              readOnly
              value={current ?? ''}
              rows={3}
              aria-label="Current save data"
              onFocus={(event) => event.currentTarget.select()}
            />
          </div>

          <div className="save-block">
            <div className="save-block-header">
              <h3>Import</h3>
              <button
                type="button"
                className="btn btn-primary"
                onClick={importDraft}
                disabled={draft.trim().length === 0}
              >
                Replace current save
              </button>
            </div>
            <textarea
              className="save-textarea"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              placeholder="Paste a save string here"
              aria-label="Save data to import"
            />
            <p className="card-error">
              Importing replaces everything currently in this browser, including permanent
              upgrades. It cannot be undone.
            </p>
          </div>

          {status && (
            <p className={`save-status-message ${status.tone === 'ok' ? 'ok' : 'bad'}`} role="status">
              {status.text}
            </p>
          )}
        </section>

        <footer className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
