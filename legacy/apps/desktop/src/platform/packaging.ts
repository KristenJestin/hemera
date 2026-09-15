/**
 * What the assembly wrote into this executable.
 *
 * The channel is fixed when the package is assembled: the assembler defines
 * `HEMERA_PACKAGED_CHANNEL` as a literal in the bundle. A run started from the sources has no
 * such definition, and is a development run whatever any package might say.
 */

import { isChannel } from '@hemera/runtime'
import type { Channel } from '@hemera/runtime'

export interface Packaging {
  packaged: Channel
  /** True when the run comes from the sources rather than from an assembled package. */
  development: boolean
}

/** The marker the assembler wrote, or null when this run comes from the sources. */
export function packagedMarker(): string | null {
  return typeof HEMERA_PACKAGED_CHANNEL === 'undefined' ? null : HEMERA_PACKAGED_CHANNEL
}

export function packagingOf(marker: string | null = packagedMarker()): Packaging {
  return marker !== null && isChannel(marker)
    ? { packaged: marker, development: false }
    : { packaged: 'dev', development: true }
}
