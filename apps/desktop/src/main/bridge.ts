/**
 * What the main process decides about a message before anything runs (design D0-04).
 *
 * Every message is read twice before anything happens: once to see where it came from, once
 * to see whether it says what its channel declares. A message that fails either is refused
 * with an error that names the channel and the field, written to the log, and dropped — the
 * handler is never reached, so a refused message has no effect to undo.
 */

import { CHANNELS, type ChannelArguments, type ChannelName } from '@hemera/ipc'

import { rendererSource } from './renderer-source.ts'

/** What a decision needs to know about the frame a message came from. */
export interface Emitter {
  url: string
}

export type Decision<K extends ChannelName> =
  | { accepted: true; argument: ChannelArguments<K> }
  | { accepted: false; reason: string }

/**
 * The origin the application's own page is served from.
 *
 * In development that is the address of the renderer server; in a package it is the file the
 * window was loaded from. Anything else is another document, and it has no business here.
 */
export function applicationOrigin(source = rendererSource()): string {
  return source.kind === 'server' ? new URL(source.location).origin : 'file://'
}

/** Whether a frame is the application's own page. */
export function isOwnFrame(emitter: Emitter | null, origin: string): boolean {
  if (emitter === null) return false
  if (origin === 'file://') return emitter.url.startsWith('file://')
  return URL.parse(emitter.url)?.origin === origin
}

export function decide<K extends ChannelName>(
  channel: K,
  emitter: Emitter | null,
  argument: unknown,
  origin: string,
): Decision<K> {
  if (!isOwnFrame(emitter, origin)) {
    return {
      accepted: false,
      reason: `${channel}: refused a message from ${emitter?.url ?? 'a frame that is already gone'}, which is not ${origin}`,
    }
  }

  const read = CHANNELS[channel].arguments.safeParse(argument)
  if (!read.success) {
    const issue = read.error.issues[0]
    const field =
      issue === undefined || issue.path.length === 0 ? 'its argument' : issue.path.join('.')
    return {
      accepted: false,
      reason: `${channel}: refused a message whose ${field} does not match the channel (${issue?.message ?? 'no detail'})`,
    }
  }
  return { accepted: true, argument: read.data as ChannelArguments<K> }
}
