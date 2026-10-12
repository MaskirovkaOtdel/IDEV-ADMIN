/**
 * Service worker registration.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * So it can be unit-tested. Registration has three failure modes that are easy to
 * ship and invisible in review: registering in development (where the worker
 * serves stale bundles and makes HMR look broken), registering at the wrong path
 * (which silently claims no scope), and throwing where `navigator.serviceWorker`
 * does not exist.
 *
 * WHY PRODUCTION ONLY
 * -------------------
 * In development the dev server serves modules straight from disk, and a service
 * worker intercepting those requests caches them. You edit a file, reload, and
 * get the old version -- which reads exactly like "my change did nothing". The
 * worker also outlives the dev server, so a stale registration can survive into
 * the next session.
 *
 * `?sw=off` additionally disables it in a production build, for anyone who needs
 * to see a deploy immediately rather than whatever the worker cached.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  if (new URLSearchParams(window.location.search).get('sw') === 'off') return;

  window.addEventListener('load', () => {
    // RELATIVE, not '/sw.js'. The site is served from /IDEV-ADMIN/ on GitHub
    // Pages and would be served from / on a custom domain; a root-absolute path
    // resolves to the domain root, 404s, and registers nothing at all — silently,
    // because a failed registration only rejects a promise nobody awaits.
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is an enhancement. A failure here must never stop the
      // game from loading, so this is deliberately swallowed rather than logged
      // as an error.
    });
  });
}