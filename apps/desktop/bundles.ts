/**
 * The five bundles of the application, declared once and used by the build and by the
 * development run.
 *
 * Four of them are the four programs Electron runs: an ESM main process on Node, a preload
 * that a sandboxed renderer can only load as CommonJS, a renderer that is a web page, and the
 * named utility process that holds the database and nothing else (design D3-01). The fifth is
 * not a program of the application but the one a bundled ACP adapter is run inside, forked once
 * per agent and outliving none of them (D5-21).
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

/**
 * The process that holds the database, which is the only one that carries the storage layer.
 *
 * It is bundled like the main process and for the same reason: `utilityProcess.fork` runs a
 * file, and one file it is. `node:sqlite` stays outside, as every Node built-in does; the ORM
 * and Effect are bundled in, so what the package carries is what the process needs.
 */
export const engineBundle: InlineConfig = {
  root: application,
  configFile: false,
  build: {
    outDir: resolve(OUTPUT, 'engine'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    lib: {
      entry: resolve(application, 'src/engine/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: { external: PROVIDED_BY_ELECTRON },
  },
}

/**
 * The program a bundled ACP adapter is run inside (D5-21).
 *
 * Bundled like the other three Node programs and for the same reason: `utilityProcess.fork` runs
 * a file. What it must not carry is the adapters themselves — they are loaded from a path decided
 * at run time, which no bundler can follow, and they travel beside a package rather than in it.
 */
export const adapterBundle: InlineConfig = {
  root: application,
  configFile: false,
  build: {
    outDir: resolve(OUTPUT, 'adapter'),
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    lib: {
      entry: resolve(application, 'src/adapter/index.ts'),
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
