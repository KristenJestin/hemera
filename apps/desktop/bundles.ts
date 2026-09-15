/**
 * The three bundles of the application, declared once and used by the build and by the
 * development run.
 *
 * They are three because Electron runs three programs: an ESM main process on Node, a preload
 * that a sandboxed renderer can only load as CommonJS, and a renderer that is a web page.
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import type { InlineConfig } from 'vite-plus'

const application = dirname(fileURLToPath(import.meta.url))

/** Where the built bundles land, and where the main process looks for them. */
export const OUTPUT = resolve(application, 'dist')

/** Electron and everything Node provides stays outside the bundles: the runtime carries it. */
const PROVIDED_BY_ELECTRON = [/^node:/, /^electron(\/.*)?$/]

export const mainBundle: InlineConfig = {
  root: application,
  configFile: false,
  build: {
    outDir: resolve(OUTPUT, 'main'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    lib: {
      entry: resolve(application, 'src/main/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: { external: PROVIDED_BY_ELECTRON },
  },
}

export const preloadBundle: InlineConfig = {
  root: application,
  configFile: false,
  build: {
    outDir: resolve(OUTPUT, 'preload'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    lib: {
      entry: resolve(application, 'src/preload/index.ts'),
      formats: ['cjs'],
      fileName: () => 'index.cjs',
    },
    rollupOptions: { external: PROVIDED_BY_ELECTRON },
  },
}

export const rendererBundle: InlineConfig = {
  root: resolve(application, 'src/renderer'),
  configFile: false,
  // The page is loaded from a file in a package, so every asset it names is relative to it.
  base: './',
  // `@vitejs/plugin-react` is typed against the `vite` package. Vite+ ships that same Vite
  // under its own name, so the plugin runs as it always did and only the nominal type differs.
  // SAFETY: same Vite, two package names; the plugins' nominal type is the only difference.
  plugins: [react(), tailwindcss()] as NonNullable<InlineConfig['plugins']>,
  build: {
    outDir: resolve(OUTPUT, 'renderer'),
    emptyOutDir: true,
  },
}
