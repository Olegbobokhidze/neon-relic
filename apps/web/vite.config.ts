import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { shareMeta } from './share-meta';

export default defineConfig({
  plugins: [
    react(),
    // Link-preview tags, JSON-LD, robots.txt and sitemap.xml (set SITE_URL for absolute URLs).
    shareMeta({
      author: 'Oleg Bobokhidze',
      genre: "Slot machine",
      imageAlt: "Neon Relic by Oleg Bobokhidze: glowing neon card and wild symbols on five reels.",
      keywords: ["slot game", "video slot", "neon slot", "free spins", "pixijs", "browser game", "react", "typescript"],
    }),
  ],
  // LAN exposure is opt-in for device testing: pnpm dev -- --host
  server: { port: 5173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Pixi is a deliberate ~170KB gz dependency (ADR-0002), isolated in its own long-cache chunk.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep the renderer in its own cacheable chunk.
        manualChunks: { pixi: ['pixi.js'], react: ['react', 'react-dom'] },
      },
    },
  },
});
