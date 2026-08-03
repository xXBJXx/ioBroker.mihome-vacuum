import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: './',
    plugins: [react()],
    build: {
        outDir: fileURLToPath(new URL('../admin', import.meta.url)),
        emptyOutDir: false,
        sourcemap: false,
        chunkSizeWarningLimit: 900,
        rollupOptions: {
            output: {
                entryFileNames: 'assets/index.js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name][extname]',
            },
        },
    },
});
