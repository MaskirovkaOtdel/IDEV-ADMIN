import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Everything is bundled: `zustand` and `break_infinity.js` must NOT be
    // externalised, otherwise the emitted bundle keeps bare specifiers
    // (`import ... from "zustand"`) that no browser can resolve.
    sourcemap: true,
  },
})
