/**
 * useAutosave — persistence heartbeat.
 *
 * Triggers (all wired, unlike the previous version where every handler body was
 * an empty comment):
 *   • every `intervalMs` (default 15s)
 *   • when the tab is hidden
 *   • on `pagehide` (the reliable unload event) and `beforeunload` as a backstop
 *
 * Writes go through `saveGameState`, which keeps a validated backup, so a crash
 * can cost at most one autosave interval of progress.
 */
import { useEffect } from 'react';
import { useGameStore } from './gameStore';

export const DEFAULT_AUTOSAVE_MS = 15_000;

export function useAutosave(intervalMs = DEFAULT_AUTOSAVE_MS): void {
  useEffect(() => {
    const save = () => {
      useGameStore.getState().save();
    };

    // A reload after an interval change must not leave the old timer running.
    // `useEffect` re-runs on `intervalMs`, and the cleanup clears the previous
    // interval and saves, so this is already handled -- but the dependency is
    // load-bearing and worth stating, because removing it would leak a timer per
    // settings change.
    const interval = setInterval(save, intervalMs);
    const onVisibility = () => {
      if (document.hidden) save();
    };
    const onPageHide = () => save();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
      save();
    };
  }, [intervalMs]);
}
