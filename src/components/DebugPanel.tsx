/**
 * DebugPanel — dev utilities, toggled with Escape.
 *
 * Everything here goes through the same store actions the UI uses, so a debug
 * action can never leave the state inconsistent.
 */
import { useState } from 'react';
import { useGameStore } from '../game/gameStore';
import { dec } from '../game/decimal';
import { estimatePrestigeMilestones } from '../game/prestige';
import { formatDecimal } from '../game/formulas';
import { serializeState } from '../game/serialize';
import { KEY_BACKUP, KEY_CORRUPT, KEY_CURRENT } from '../game/storage';

export interface DebugPanelProps {
  isVisible: boolean;
  setVisible: (visible: boolean) => void;
}

export function DebugPanel({ isVisible, setVisible }: DebugPanelProps) {
  const gameState = useGameStore((s) => s.gameState);
  const transient = useGameStore((s) => s.transient);
  const performPrestige = useGameStore((s) => s.performPrestige);
  const save = useGameStore((s) => s.save);
  const exportSave = useGameStore((s) => s.exportSave);
  const loadFromString = useGameStore((s) => s.loadFromString);
  const hardReset = useGameStore((s) => s.hardReset);
  const tick = useGameStore((s) => s.tick);
  const grantResources = useGameStore((s) => s.grantResources);

  const [grantAmount, setGrantAmount] = useState('1e6');
  const [log, setLog] = useState<string[]>([]);

  if (!isVisible) return null;

  const append = (message: string) =>
    setLog((prev) => [message, ...prev].slice(0, 8));

  const grant = (resource: 'cash' | 'linesOfCode' | 'coffee') => {
    const amount = dec(Number(grantAmount) || 0);
    // Goes through the store so tickVersion and the production snapshot stay
    // consistent; a direct write would leave cards showing a stale rate.
    grantResources(resource, amount);
    append(`Granted ${grantAmount} ${resource}`);
  };

  const runTicks = (seconds: number) => {
    for (let i = 0; i < seconds * 10; i += 1) tick(0.1);
    append(`Simulated ${seconds}s`);
  };

  const doExport = () => {
    const json = exportSave();
    if (!json) return;
    void navigator.clipboard?.writeText(json).then(
      () => append(`Save copied (${json.length} bytes)`),
      () => append('Clipboard blocked; save logged to console'),
    );
    console.log('[save]', json);
  };

  const doImport = () => {
    const json = window.prompt('Paste a save string');
    if (!json) return;
    const result = loadFromString(json);
    append(result.ok ? 'Save imported' : `Import failed: ${result.error}`);
  };

  return (
    <aside className="debug-panel" aria-label="Debug panel">
      <header className="debug-header">
        <h2>Debug</h2>
        <button type="button" className="modal-close" onClick={() => setVisible(false)} aria-label="Close">
          ×
        </button>
      </header>

      <section className="debug-section">
        <h3>Resources</h3>
        <input
          className="debug-input"
          value={grantAmount}
          onChange={(event) => setGrantAmount(event.target.value)}
          aria-label="Amount to grant"
        />
        <div className="debug-buttons">
          <button type="button" onClick={() => grant('cash')}>
            +Cash
          </button>
          <button type="button" onClick={() => grant('linesOfCode')}>
            +LoC
          </button>
          <button type="button" onClick={() => grant('coffee')}>
            +Coffee
          </button>
        </div>
      </section>

      <section className="debug-section">
        <h3>Simulation</h3>
        <div className="debug-buttons">
          <button type="button" onClick={() => runTicks(60)}>
            +60s
          </button>
          <button type="button" onClick={() => runTicks(600)}>
            +10m
          </button>
          <button type="button" onClick={() => append(performPrestige().ok ? 'Prestige done' : 'Prestige refused')}>
            Prestige
          </button>
        </div>
      </section>

      <section className="debug-section">
        <h3>Save</h3>
        <div className="debug-buttons">
          <button type="button" onClick={() => append(save() ? 'Saved' : 'Save failed')}>
            Save now
          </button>
          <button type="button" onClick={doExport}>
            Export
          </button>
          <button type="button" onClick={doImport}>
            Import
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => {
              if (window.confirm('Delete every save slot and start over?')) {
                hardReset();
                append('Save wiped');
              }
            }}
          >
            Hard reset
          </button>
        </div>
        <p className="debug-note">
          Keys: {KEY_CURRENT}, {KEY_BACKUP}, {KEY_CORRUPT}
        </p>
      </section>

      <section className="debug-section">
        <h3>State</h3>
        <dl className="debug-state">
          <div>
            <dt>cash</dt>
            <dd>{formatDecimal(gameState.resources.cash)}</dd>
          </div>
          <div>
            <dt>lifetime cash</dt>
            <dd>{formatDecimal(gameState.resources.lifetimeCash)}</dd>
          </div>
          <div>
            <dt>cash/sec</dt>
            <dd>{formatDecimal(transient.production.cashPerSec)}</dd>
          </div>
          <div>
            <dt>tech debt</dt>
            <dd>{formatDecimal(gameState.prestige.techDebt)}</dd>
          </div>
          <div>
            <dt>cost mult</dt>
            <dd>×{transient.costDiscount.toString()}</dd>
          </div>
          <div>
            <dt>schema</dt>
            <dd>v{gameState.version}</dd>
          </div>
        </dl>
        <p className="debug-note">
          Prestige curve:{' '}
          {estimatePrestigeMilestones()
            .map((row) => `${row.lifetimeCash}→${row.techDebt}`)
            .join('  ')}
        </p>
        <p className="debug-note">save bytes: {serializeState(gameState).length}</p>
      </section>

      {log.length > 0 && (
        <section className="debug-section">
          <h3>Log</h3>
          <ul className="debug-log">
            {log.map((entry, index) => (
              <li key={`${entry}-${index}`}>{entry}</li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}
