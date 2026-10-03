/** Which build of Hemera this run is: its channel and its version. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Channel } from '@hemera/ipc'
import { Option, Schema } from 'effect'

export interface Identity {
  readonly channel: Channel
  readonly version: string
}

/** What a manifest says about the channel; packaging writes it, a development run has none. */
const Manifest = Schema.fromJsonString(
  Schema.Struct({ hemera: Schema.Struct({ channel: Channel }) }),
)

/** The channel a manifest names, or `dev` when it names none it knows. */
export function channelOf(manifest: string): Channel {
  return Option.match(Schema.decodeUnknownOption(Manifest)(manifest), {
    onNone: () => 'dev',
    onSome: ({ hemera }) => hemera.channel,
  })
}

export function identityOf(appPath: string, version: string): Identity {
  let manifest = ''
  try {
    manifest = readFileSync(join(appPath, 'package.json'), 'utf8')
  } catch {
    // No manifest where the application runs from: nothing says it is anything but dev.
  }
  return { channel: channelOf(manifest), version }
}
