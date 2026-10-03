/** Where the renderer comes from: a development server when one is running, the bundle else. */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Set by the development run to the address its renderer server picked. */
export const RENDERER_URL_VARIABLE = 'HEMERA_RENDERER_URL'

export interface RendererSource {
  kind: 'server' | 'bundle'
  location: string
}

export function rendererSource(
  environment: Record<string, string | undefined> = process.env,
): RendererSource {
  const served = environment[RENDERER_URL_VARIABLE]
  if (served !== undefined && served !== '') return { kind: 'server', location: served }
  const main = dirname(fileURLToPath(import.meta.url))
  return { kind: 'bundle', location: join(main, '..', 'renderer', 'index.html') }
}
