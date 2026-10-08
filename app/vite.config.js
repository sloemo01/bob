import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Two entries: the demo (index.html) and the drop-in component playground
// (bob.html, which mounts only src/components/Bob.jsx).
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        bob: 'bob.html',
      },
    },
  },
})
