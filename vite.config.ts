import { defineConfig } from 'vite';

// Declared locally rather than pulling in @types/node: this is the only Node global
// the project touches, and the dependency would not earn its place for one read.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  // GitHub Pages serves the app from /thumbproof/; local dev serves from root.
  base: process.env.GH_PAGES ? '/thumbproof/' : '/',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    // Two entry points: the tool, and the live self-test that runs the analyser
    // over every sample and checks each lands on its authored verdict.
    rollupOptions: { input: ['index.html', 'selftest.html'] },
  },
});
