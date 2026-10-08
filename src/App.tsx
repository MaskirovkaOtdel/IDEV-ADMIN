/**
 * Dev tools are compiled out of production builds.
 *
 * The debug panel grants resources, simulates ticks and hard-resets the save.
 * None of that can corrupt a real save — `grantResources` deliberately leaves
 * lifetime accounting alone — but it has no business being reachable by a
 * player who did not build the game. It was previously wired to a visible
 * sidebar link and the Escape key with no guard at all, so every visitor to the
 * deployed site had it.
 *
 * This constant gates all three entry points rather than just the button: the
 * Escape handler and the panel render are checked too, so the shortcut cannot
 * reopen what the link hides.
 *
 * `import.meta.env.DEV` is a build-time substitution, not a runtime check, so
 * this collapses to `false` in the shipped bundle and the code is dead-weight
 * dropped by minification.
 */
const DEV_TOOLS_ENABLED = import.meta.env.DEV;

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
  // Driven by the reset actually landing, not by the button being clicked: the
  // click can be refused, and a sweep that fired on a refusal would tell the
  // player something happened that did not.
  const prestigeCount = useGameStore((s) => s.gameState.stats.prestigeCount);

  const [hydrated, setHydrated] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [burning, setBurning] = useState(false);
  const hydratedRef = useRef(false);

  // Hydrate exactly once, even under React 19 StrictMode double-invocation.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    hydrate();
    setHydrated(true);
  }, [hydrate]);

  // Escape toggles the debug panel — dev builds only, so the shortcut cannot
  // reach tools the sidebar link does not offer in production.
  useEffect(() => {
    if (!DEV_TOOLS_ENABLED) return;
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
      return;
    }
    // Confirm the reset changed something before celebrating it.
    if (useGameStore.getState().gameState.stats.prestigeCount !== prestigeCount) {
      setBurning(true);
    }
  }, [performPrestige, prestigeCount]);

  // Clear the burn after the sweep has run. A timer rather than a CSS class
  // left on permanently, so re-renders cannot re-arm the animation.
  useEffect(() => {
    if (!burning) return;
    const timer = setTimeout(() => setBurning(false), 800);
    return () => clearTimeout(timer);
  }, [burning]);

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
        onOpenDebug={DEV_TOOLS_ENABLED ? () => setDebugOpen(true) : undefined}
        burning={burning}
      />

      <GameRuntime />

      <OfflineReportModal />
      <ConfirmResetModal
        isOpen={confirmResetOpen}
        onClose={() => setConfirmResetOpen(false)}
        onConfirm={onConfirmPrestige}
      />

      {/* Never mounted in a production build: without this the Escape handler could
          still flip debugOpen and render the panel, defeating the guard on the
          sidebar link. */}
      {DEV_TOOLS_ENABLED && <DebugPanel isVisible={debugOpen} setVisible={setDebugOpen} />}
    </div>
  );
}
