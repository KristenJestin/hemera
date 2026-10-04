#!/usr/bin/env node
/**
 * Image sequences of a story, for what the story tests cannot see: the journey of a movement.
 *
 * The stories run as tests asking for less movement, so a play checks where a component lands
 * and never how it got there. Whether a tint breathes, a sweep crosses once, a mark morphs in
 * place or a body pushes what is under it is read on pictures: this opens a story of a running
 * catalogue, optionally changes its arguments in place — the component stays mounted, so the
 * change is played as a user would see it — and writes a frame every few milliseconds.
 *
 *   pnpm storybook   # in another terminal, or any catalogue that is running
 *   pnpm --filter @hemera/ui frames --story components-statusmark--running \
 *     --set state=done --frames 12 --every 40 --out /tmp/status-mark
 *
 * `--set name=value` may be repeated; `now` is the time the change is made, in milliseconds,
 * `null` is null, a number is a number, and a value that opens with `[` or `{` is read as JSON —
 * a list with one row more, to watch it arrive. `--theme dark` draws the dark theme.
 */

import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

/** What a sequence is asked for. */
export interface Sequence {
  readonly story: string
  readonly url: string
  readonly theme: 'light' | 'dark'
  readonly frames: number
  readonly every: number
  readonly out: string
  readonly set: ReadonlyMap<string, string>
}

/** The command line, read into a sequence; a missing `--story` or `--out` is refused. */
export function sequenceOf(argv: readonly string[]): Sequence {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      story: { type: 'string' },
      url: { type: 'string', default: 'http://localhost:6006' },
      theme: { type: 'string', default: 'light' },
      frames: { type: 'string', default: '12' },
      every: { type: 'string', default: '40' },
      out: { type: 'string' },
      set: { type: 'string', multiple: true, default: [] },
    },
  })
  if (values.story === undefined) throw new Error('--story names the story, as its id')
  if (values.out === undefined) throw new Error('--out names the folder the frames go to')
  if (values.theme !== 'light' && values.theme !== 'dark') {
    throw new Error('--theme is light or dark')
  }
  const set = new Map<string, string>()
  for (const pair of values.set) {
    const at = pair.indexOf('=')
    if (at < 1) throw new Error(`--set ${pair}: write it name=value`)
    set.set(pair.slice(0, at), pair.slice(at + 1))
  }
  return {
    story: values.story,
    url: values.url,
    theme: values.theme,
    frames: Number.parseInt(values.frames, 10),
    every: Number.parseInt(values.every, 10),
    out: resolve(values.out),
    set,
  }
}

/** A value written as JSON: what a list or a record of a story's arguments holds. */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json }

/** A value of `--set`, as the story's argument receives it. */
export type ArgValue = string | number | null | Json

/**
 * One value of `--set`: `now` is the moment the change is made, `null` null, digits a number, and
 * a list or a record written as JSON what it holds.
 */
export function valueOf(written: string, now: number): ArgValue {
  if (/^[[{]/.test(written)) {
    // `JSON.parse` answers nothing but JSON values, which is what `Json` describes.
    const read: Json = JSON.parse(written)
    return read
  }
  if (written === 'now') return now
  if (written === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(written)) return Number(written)
  return written
}

/** The page of the catalogue that draws one story alone, in one theme. */
export function storyUrl(sequence: Sequence): string {
  const story = encodeURIComponent(sequence.story)
  return `${sequence.url}/iframe.html?id=${story}&viewMode=story&globals=theme:${sequence.theme}`
}

async function record(sequence: Sequence): Promise<void> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 })
    await page.goto(storyUrl(sequence))
    const root = page.locator('#storybook-root')
    await root.locator(':scope > *').first().waitFor()
    // The story's play runs in the page as it opens and may leave a control focused or hovered:
    // it is given time to finish, then the pointer and the focus are taken away, so a sequence
    // shows the component at rest and not what the play left behind.
    await page.waitForTimeout(1500)
    await page.mouse.move(0, 0)
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await page.waitForTimeout(500)
    mkdirSync(sequence.out, { recursive: true })
    if (sequence.set.size > 0) {
      const updatedArgs = Object.fromEntries(
        [...sequence.set].map(([name, written]) => [name, valueOf(written, Date.now())]),
      )
      // Carried as text and read in the page: a list of rows is deeper than the types of what
      // Playwright carries can follow.
      await page.evaluate(
        ({ storyId, args }) => {
          const channel = Reflect.get(globalThis, '__STORYBOOK_ADDONS_CHANNEL__')
          channel.emit('updateStoryArgs', { storyId, updatedArgs: JSON.parse(args) })
        },
        { storyId: sequence.story, args: JSON.stringify(updatedArgs) },
      )
    }
    for (let frame = 0; frame < sequence.frames; frame += 1) {
      const name = `frame-${String(frame).padStart(2, '0')}.png`
      // oxlint-disable-next-line no-await-in-loop -- one frame after the other, on the clock
      await root.screenshot({ path: join(sequence.out, name), animations: 'allow' })
      // oxlint-disable-next-line no-await-in-loop -- the gap between two frames is the point
      await page.waitForTimeout(sequence.every)
    }
    console.log(`${String(sequence.frames)} frames of ${sequence.story} in ${sequence.out}`)
  } finally {
    await browser.close()
  }
}

if (import.meta.main) {
  await record(sequenceOf(process.argv.slice(2)))
}
