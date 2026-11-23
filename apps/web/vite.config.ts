import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
