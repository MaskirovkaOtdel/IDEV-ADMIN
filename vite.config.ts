import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built site works from any sub-path.
  // GitHub Pages serves this project at /IDEV-ADMIN/, but a custom domain would
  // serve from / — using a relative base means the same build works for both,
  // so switching to a domain later is a DNS change rather than a rebuild.
  base: './',
  build: {
    // Everything is bundled: `zustand` and `break_infinity.js` must NOT be
    // externalised, otherwise the emitted bundle keeps bare specifiers
    // (`import ... from "zustand"`) that no browser can resolve.
    sourcemap: true,
    // The deploy workflow has a 10 minute budget; keep well inside it.
    chunkSizeWarningLimit: 600,
  },
})
