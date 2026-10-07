import { useCallback, useEffect, useRef, useState } from 'react';
import { Layout } from './ui/Layout';
import { ConfirmResetModal } from './ui/ConfirmResetModal';
import { OfflineReportModal } from './ui/OfflineReportModal';
import { DebugPanel } from './components/DebugPanel';
import { LoadingIndicator } from './ui/LoadingIndicator';
import { useGameStore } from './game/gameStore';
import { useGameLoop } from './game/useGameLoop';
import { useAutosave } from './game/useAutosave';
import './App.css';

/**
 * Owns the simulation heartbeat, autosave and hidden-tab catch-up.
 *
 * Rendered only once the save has been hydrated, so the first tick never runs
 * against a default state and overwrites the player's real save.
 */
function GameRuntime() {
  const tick = useGameStore((s) => s.tick);
  const catchUp = useGameStore((s) => s.catchUp);
  const save = useGameStore((s) => s.save);

  useAutosave();
  // The loop pauses itself while the tab is hidden; this handler credits the
  // hidden span once, at offline efficiency, when the player comes back.
  useGameLoop(tick);

  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        save();
        return;
      }
      if (hiddenAt > 0) {
        const elapsed = Date.now() - hiddenAt;
        hiddenAt = 0;
        catchUp(elapsed);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [catchUp, save]);

  return null;
}

export default function App() {
  const hydrate = useGameStore((s) => s.hydrate);
  const performPrestige = useGameStore((s) => s.performPrestige);

  const [hydrated, setHydrated] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const hydratedRef = useRef(false);

  // Hydrate exactly once, even under React 19 StrictMode double-invocation.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    hydrate();
    setHydrated(true);
  }, [hydrate]);

  // Escape toggles the debug panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDebugOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const onConfirmPrestige = useCallback(() => {
    const result = performPrestige();
    setConfirmResetOpen(false);
    if (!result.ok && result.error) {
      console.warn('[prestige]', result.error);
    }
  }, [performPrestige]);

  if (!hydrated) {
    return (
      <div className="app">
        <LoadingIndicator message="Restoring your workspace…" />
      </div>
    );
  }

  return (
    <div className="app">
      <Layout
        onOpenPrestige={() => setConfirmResetOpen(true)}
        onOpenDebug={() => setDebugOpen(true)}
      />

      <GameRuntime />

      <OfflineReportModal />
      <ConfirmResetModal
        isOpen={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        onConfirm={onConfirmPrestige}
      />

      <DebugPanel isVisible={debugOpen} setVisible={setDebugOpen} />
    </div>
  );
}
