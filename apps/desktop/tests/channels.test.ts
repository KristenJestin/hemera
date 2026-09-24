/**
 * Every declared channel is wired in the main process (design D0-04, D5-17).
 *
 * The relay is a hard-coded list of names, so a channel declared on the wire and left out of it
 * is a channel the page calls and nothing answers — which is what `agents.offerSet` was between
 * being declared and being relayed. What the main process answers itself is read off its own
 * source rather than listed again here: a second copy of that list would be the same omission
 * written twice, and it would go on agreeing with itself while the wire moved on.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { CHANNELS } from '@hemera/ipc'

const SOURCE = readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'channels.ts'), 'utf8')

/** The names the main process answers itself, each written on its own `handle` call. */
const ANSWERED = /handle\('([\w.]+)'/g

/** The names it hands straight to the engine, read out of the list it holds them in. */
const LIST = /const RELAYED = \[([\s\S]*?)\] as const/

/** One quoted channel name, as both the list and the calls write one. */
const NAME = /'([\w.]+)'/g

function wired(): Set<string> {
  const relayed = LIST.exec(SOURCE)?.[1] ?? ''
  return new Set([
    ...[...SOURCE.matchAll(ANSWERED)].map(([, name]) => name ?? ''),
    ...[...relayed.matchAll(NAME)].map(([, name]) => name ?? ''),
  ])
}

describe('Tout canal déclaré est branché', () => {
  test('every declared channel is relayed to the engine or answered by the main process', () => {
    const known = wired()
    expect(Object.keys(CHANNELS).filter((channel) => !known.has(channel))).toEqual([])
  })

  test('the option a Home sets on the agent it is offered reaches the engine', () => {
    expect(wired().has('agents.offerSet')).toBe(true)
  })

  test('the commands and the Context view reach the engine, relayed and not answered here', () => {
    const relayed = LIST.exec(SOURCE)?.[1] ?? ''
    const names = new Set([...relayed.matchAll(NAME)].map(([, name]) => name ?? ''))
    const lent = Object.keys(CHANNELS).filter(
      (channel) => channel.startsWith('commands.') || channel.startsWith('context.'),
    )
    expect(lent).toHaveLength(12)
    expect(lent.filter((channel) => !names.has(channel))).toEqual([])
  })
})
