// Plain config object (no imports) so this folder needs no node_modules of
// its own: it runs with the app's vite binary.
//
//   cd component && ../app/node_modules/.bin/vite build     (or ./build.sh)
//
// dist/bob.js   — ESM bundle, react externalized
// dist/bob.cjs  — CommonJS bundle, react externalized
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
