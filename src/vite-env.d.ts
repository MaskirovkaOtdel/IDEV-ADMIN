/// <reference types="vite/client" />

/**
 * Build-time constants, inlined by Vite.
 *
 * `__APP_VERSION__` is substituted by the `define` in vite.config.ts, which reads
 * package.json. It exists so the sidebar version is never written down twice —
 * it was hardcoded, and it shipped showing the previous release's number.
 */
declare const __APP_VERSION__: string;