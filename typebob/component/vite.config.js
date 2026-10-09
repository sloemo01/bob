// Plain config object (no imports) so the bundler needs no config-side deps.
//
//   ./build.sh      (or: npm run build)
//
// dist/bob.js   — ESM bundle, react externalized
// dist/bob.cjs  — CommonJS bundle, react externalized
// The ring warm-up worker is emitted as its own asset; the bundle references
// it via new URL(..., import.meta.url).
export default {
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'src/index.js',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'bob.js' : 'bob.cjs'),
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
    },
  },
}
