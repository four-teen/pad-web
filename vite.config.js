import { defineConfig } from 'vite';

export default defineConfig({
  // Vercel serves dist at /. Relative assets also support local Apache previews.
  base: './',
  server: {
    // Support an existing local .env that uses /pad-api/public.
    proxy: {
      '/pad-api/public': {
        target: 'http://localhost',
        changeOrigin: true,
      },
    },
  },
});
