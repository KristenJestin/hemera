/**
 * The channels the renderer may call, and nothing else (design D0-04).
 *
 * A channel is a name, a schema for what it is called with, and a type for what it answers.
 * Both sides read this one declaration: the main process to validate what arrives, the
 * renderer to know what it may ask and what it gets back. A name that is not here does not
 * compile, so an untyped channel cannot be opened by accident.
 */

import { z } from 'zod'

import { environmentReportSchema } from './environment.ts'

/** What the window can be asked to do. Lot 2 wires these to the shell's own controls. */
export const windowCommandSchema = z.object({
  command: z.enum(['minimize', 'maximize', 'close']),
})

/**
 * Which theme the user asked for, which is a preference and not a colour: `system` is a
 * choice too, and it is the one that has to reach the main process — only the platform can
 * lift an override, and only the main process can tell the platform to.
 */
export const themeSchema = z.object({
  preference: z.enum(['system', 'light', 'dark']),
})

/** What the user can ask for; `system` means "whatever the desktop says, from now on". */
export type ThemePreference = z.infer<typeof themeSchema>['preference']

const nothingSchema = z.object({})

/**
 * Every channel of the application.
 *
 * `arguments` is what the caller sends and the main process validates; `response` is the
 * schema of what comes back, so the type of an answer is read from the same place.
 */
export const CHANNELS = {
  'env.report': {
    arguments: nothingSchema,
    response: environmentReportSchema,
  },
  'window.command': {
    arguments: windowCommandSchema,
    response: z.void(),
  },
  'theme.set': {
    arguments: themeSchema,
    response: z.void(),
  },
} as const

export type Channels = typeof CHANNELS

export type ChannelName = keyof Channels

export type ChannelArguments<K extends ChannelName> = z.infer<Channels[K]['arguments']>

export type ChannelResponse<K extends ChannelName> = z.infer<Channels[K]['response']>

/** The shape the preload exposes to the renderer, derived from the declaration above. */
export interface Bridge {
  invoke<K extends ChannelName>(
    channel: K,
    argument: ChannelArguments<K>,
  ): Promise<ChannelResponse<K>>
}
