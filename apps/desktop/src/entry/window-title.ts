/**
 * Title of the window.
 *
 * The channel is part of it: a development instance running beside an installed one must be
 * told apart at a glance.
 */

import type { Channel } from '../platform/channel.ts'

export function windowTitleOf(name: string, channel: Channel): string {
  return channel === 'prod' ? name : `${name} (${channel})`
}
