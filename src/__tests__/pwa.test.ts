/**
 * PWA: manifest, icons, service worker.
 *
 * WHY THIS FILE IS MOSTLY ABOUT WHAT CANNOT BREAK
 * ----------------------------------------------
 * A PWA is a cache in front of an application whose entire state lives in
 * localStorage. The obvious failure is a stale shell pinning players to an old
 * build forever; the subtle one is a caching rule that treats progress like an
 * asset.
 *
 * So the assertions below are mostly negative: the manifest must not lie about
 * its scope, the worker must not be registered in development, and nothing may be
 * cached in a way that could evict `idev-admin:save`. That last one is safe by
 * construction β€” localStorage is not a network request and a service worker cannot
 * intercept it β€” and the test says so explicitly, because "it's fine" is a claim
 * that should be pinned rather than assumed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerServiceWorker } from '../registerServiceWorker';

const root = resolve(import.meta.dirname, '..', '..');
const read = (...p: string[]) => readFileSync(resolve(root, ...p), 'utf8');

/**
 * Strip comments so prose about a rule cannot fail the rule's own assertion.
 *
 * sw.js documents WHY it cannot touch `idev-admin:save`, which means the string
 * appears in the file. A naive substring check then fails on the explanation of
 * the guarantee instead of on a violation of it. Same helper the settings test
 * uses, for the same reason.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const manifest = JSON.parse(read('public', 'manifest.webmanifest'));
const sw = read('public', 'sw.js');
/** Comments stripped: these assertions are about behaviour, not documentation. */
const swCode = code(sw);
const html = read('index.html');

describe('the manifest', () => {
  it('declares the fields an install prompt needs', () => {
    for (const key of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons']) {
      expect(manifest[key], `manifest.${key} is missing`).toBeTruthy();
    }
    expect(manifest.display).toBe('standalone');
  });

  it('uses relative paths, because the site is served from a sub-path', () => {
    // GitHub Pages serves this at /IDEV-ADMIN/ and a custom domain would serve
    // from /. A root-absolute start_url would launch the installed app from the
    // domain root and 404.
    expect(manifest.start_url.startsWith('./')).toBe(true);
    expect(manifest.scope.startsWith('./')).toBe(true);
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
  });

  it('every icon it references actually exists', () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('./'), `${icon.src} is not relative`).toBe(true);
      const path = resolve(root, 'public', icon.src.replace('./', ''));
      expect(() => readFileSync(path), `missing icon ${icon.src}`).not.toThrow();
      expect(icon.type).toBeTruthy();
      expect(icon.sizes).toBeTruthy();
    }
  });

  it('ships a maskable icon, or Android crops the logo into a sliver', () => {
    const maskable = manifest.icons.filter((i: { purpose?: string }) =>
      String(i.purpose ?? '').includes('maskable')
    );
    expect(maskable.length, 'no maskable icon declared').toBeGreaterThan(0);
  });

  it('the maskable icon keeps its artwork inside the safe zone', () => {
    // A maskable icon may lose up to 20% of its width on every side. Artwork
    // filling the canvas gets clipped; this checks the transform actually scales
    // it down rather than trusting the `purpose` field.
    const svg = read('public', 'icon-maskable.svg');
    const scale = /scale\(([\d.]+)\)/.exec(svg);
    expect(scale, 'no scale() transform found in the maskable icon').toBeTruthy();
    expect(Number(scale![1])).toBeLessThanOrEqual(0.8);
    // And it must have an opaque background, or a circular mask shows through.
    expect(svg).toMatch(/<rect[^>]*fill="#0b0d12"/);
  });

  it('theme and background match the CSS tokens the game actually uses', () => {
    const css = read('src', 'index.css');
    const bg = /--bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(bg, 'could not read --bg from index.css').toBeTruthy();
    // A manifest whose splash background differs from the app's own background
    // flashes a different colour on launch, which reads as a glitch.
    expect(manifest.background_color.toLowerCase()).toBe(bg!.toLowerCase());
    expect(manifest.theme_color.toLowerCase()).toBe(bg!.toLowerCase());
  });
});

describe('the service worker', () => {
  it('does not cache the game state, and cannot', () => {
    // localStorage is not a network request. No service worker can intercept it,
    // so `idev-admin:save` cannot be evicted by cache expiry -- which is the
    // usual way a PWA destroys an idle game's progress. Stated as a test because
    // "it can't happen" is a claim that should be pinned, and because a future
    // move to IndexedDB or a Cache Storage save WOULD break it.
    expect(swCode).not.toMatch(/idev-admin:save/);
    expect(swCode).not.toMatch(/caches\.open\([^)]*save/);
  });

  it('serves the document network-first, so a new deploy is not pinned forever', () => {
    // Cache-first on the document means a stale index.html keeps pointing at the
    // old hashed bundle indefinitely. This is the single most common way a PWA
    // ships an update that never arrives.
    expect(swCode).toMatch(/request\.mode === 'navigate'/);
    expect(swCode).toMatch(/networkFirst\(request\)/);
  });

  it('falls back to the cache on a gateway error, not only on a thrown fetch', () => {
    // Found by testing, not by reasoning: with the origin server stopped, the
    // page returned 502 instead of the cached shell. Any proxy, CDN or captive
    // portal in the path answers a dead origin with 502/503/504 rather than a
    // connection error, and a handler that only catches thrown fetches passes
    // that status straight through to the player — handing them a gateway error
    // page instead of the game, which is precisely what the cache exists to stop.
    expect(swCode).toMatch(/if \(response\.ok\)/);
    expect(swCode).toMatch(/network responded \$\{response\.status\}/);
  });

  it('looks entries up ignoring Vary, or a cached asset can become unreachable', () => {
    // Also found by testing. `Vary: Origin` (sent by Vite's preview server, and
    // addable by any CDN in front of GitHub Pages) makes `cache.match()` compare
    // request headers. An entry cached from a request without an `Origin` header
    // is then invisible to a later request that has one: present in
    // `caches.keys()`, unfetchable. Observed exactly that on the hashed bundle.
    expect(swCode).toMatch(/ignoreVary:\s*true/);
    // And the lookup must be funnelled through the helper, not done inline.
    const inline = /cache\.match\(request\)(?!,)/.test(swCode);
    expect(inline, 'a raw cache.match(request) bypasses the Vary-safe helper').toBe(
      false
    );
  });

  it('only ever stores a successful basic response', () => {
    // Caching a 404 or an opaque response pins the broken thing for the whole
    // offline window, which is worse than having no cache at all.
    expect(swCode).toMatch(/response\.ok/);
    expect(swCode).toMatch(/response\.type === 'basic'/);
  });

  it('ignores non-GET and cross-origin requests', () => {
    expect(swCode).toMatch(/request\.method !== 'GET'/);
    expect(swCode).toMatch(/url\.origin !== self\.location\.origin/);
  });

  it('clears caches from previous versions on activate', () => {
    // Otherwise every deploy leaves its old hashed assets in storage forever.
    expect(swCode).toMatch(/caches\.delete/);
    expect(swCode).toMatch(/key !== CACHE/);
  });

  it('names a cache, because an unnamed one cannot be replaced', () => {
    expect(swCode).toMatch(/const CACHE = `idev-admin-/);
  });
});

describe('the document', () => {
  it('links the manifest with a relative href', () => {
    expect(html).toMatch(/<link rel="manifest" href="\.\/manifest\.webmanifest"/);
  });

  it('declares mobile web-app capability', () => {
    expect(html).toMatch(/name="mobile-web-app-capable"/);
    expect(html).toMatch(/apple-mobile-web-app-capable/);
  });

  it('references the same theme colour as the manifest', () => {
    // They drift easily and the result is a status bar that does not match the app.
    const meta = /name="theme-color" content="([^"]+)"/.exec(html)?.[1];
    expect(meta?.toLowerCase()).toBe(manifest.theme_color.toLowerCase());
  });
});

describe('registration', () => {
  const listeners: Record<string, EventListener[]> = {};

  beforeEach(() => {
    for (const k of Object.keys(listeners)) delete listeners[k];
    (window as unknown as { addEventListener: unknown }).addEventListener = (
      type: string,
      fn: EventListener
    ) => {
      (listeners[type] ??= []).push(fn);
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubEnv(prod: boolean) {
    vi.stubEnv('PROD', prod);
  }

  function fireLoad() {
    for (const fn of listeners.load ?? []) fn(new Event('load'));
  }

  it('does not register in development', () => {
    // A worker caching the dev server's modules makes an edit look like it did
    // nothing. That is a genuinely confusing bug to hand a contributor.
    stubEnv(false);
    const register = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });

    registerServiceWorker();
    fireLoad();

    expect(register).not.toHaveBeenCalled();
  });

  it('registers a RELATIVE path in production', () => {
    // '/sw.js' resolves to the domain root, 404s under /IDEV-ADMIN/, and
    // registers nothing -- silently, because the rejection is unobserved.
    stubEnv(true);
    const register = vi.fn().mockResolvedValue({});
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });

    registerServiceWorker();
    fireLoad();

    expect(register).toHaveBeenCalledWith('./sw.js');
  });

  it('survives a registration failure without breaking the game', () => {
    // A rejected promise nobody awaits would surface as an unhandled rejection,
    // which some error reporters treat as a crash.
    stubEnv(true);
    const register = vi.fn().mockRejectedValue(new Error('no scope'));
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });

    expect(() => {
      registerServiceWorker();
      fireLoad();
    }).not.toThrow();
  });

  it('?sw=off disables it in production, for testing a deploy immediately', () => {
    stubEnv(true);
    const register = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });

    const original = window.location.search;
    Object.defineProperty(window, 'location', {
      value: { search: '?sw=off' },
      configurable: true,
    });

    registerServiceWorker();
    fireLoad();
    expect(register).not.toHaveBeenCalled();

    Object.defineProperty(window, 'location', { value: { search: original }, configurable: true });
  });

  it('does nothing when the browser has no service worker support', () => {
    stubEnv(true);
    // @ts-expect-error deliberately removing the API to simulate an old browser
    delete navigator.serviceWorker;

    expect(() => {
      registerServiceWorker();
      fireLoad();
    }).not.toThrow();
  });
});