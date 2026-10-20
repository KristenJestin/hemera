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
 * The frames are those the page painted on its own while the change played, not screenshots
 * taken one after the other: a screenshot takes longer than a fold lasts, so a sequence of them
 * showed a row already arrived from its first frame.
 *
 *   pnpm storybook   # in another terminal, or any catalogue that is running
 *   pnpm --filter @hemera/ui frames --story components-statusmark--running \
 *     --set state=done --frames 12 --every 40 --out /tmp/status-mark
 *
 * `--set name=value` may be repeated; `now` is the time the change is made, in milliseconds,
 * `null` is null, a number is a number, and a value that opens with `[` or `{` is read as JSON —
 * a list with one row more, to watch it arrive. `--theme dark` draws the dark theme.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
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

/** A frame the page painted, at the moment it was painted, in milliseconds since the epoch. */
export interface Painted {
  readonly at: number
}

/**
 * The frames of a sequence: at the change and every few milliseconds after it, the last frame the
 * page had painted by then; a moment before the first frame painted is shown by that first one.
 */
export function framesAt<Frame extends Painted>(
  painted: readonly Frame[],
  from: number,
  frames: number,
  every: number,
): Frame[] {
  const first = painted[0]
  if (first === undefined) return []
  return Array.from({ length: frames }, (_, index) => {
    const moment = from + index * every
    return painted.findLast((frame) => frame.at <= moment) ?? first
  })
}

/**
 * The moment a sequence starts: just before the first frame painted after the change was asked.
 * An idle page paints nothing, so that frame is the change, however long the catalogue took to
 * render it; undefined while nothing has been painted since.
 */
export function changeAt(painted: readonly Painted[], asked: number): number | undefined {
  const first = painted.find((frame) => frame.at > asked)
  return first === undefined ? undefined : first.at - 1
}

/** The device's scale the frames are drawn at. */
const SCALE = 2

async function record(sequence: Sequence): Promise<void> {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ deviceScaleFactor: SCALE })
    await page.goto(storyUrl(sequence))
    const root = page.locator('#storybook-root')
    await root.locator(':scope > *').first().waitFor()
    // The story's play runs in the page as it opens and may leave a control focused or hovered:
    // the catalogue is waited on until its render has finished, play included — a loaded machine
    // types slowly, and a change made while the play still types is overwritten by it — then the
    // pointer and the focus are taken away, so a sequence shows the component at rest and not
    // what the play left behind.
    await page.waitForFunction(
      () => {
        const preview = Reflect.get(globalThis, '__STORYBOOK_PREVIEW__')
        return ['finished', 'errored'].includes(preview?.currentRender?.phase)
      },
      undefined,
      { timeout: 60_000 },
    )
    await page.mouse.move(0, 0)
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })
    await page.waitForTimeout(500)
    mkdirSync(sequence.out, { recursive: true })
    // Every frame the page paints, at the device's scale, kept with the moment it was painted;
    // carried as JPEG, because encoding PNG at this scale slows the frames down.
    const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
    const cdp = await page.context().newCDPSession(page)
    const painted: { at: number; data: string }[] = []
    cdp.on('Page.screencastFrame', (frame) => {
      const seconds = frame.metadata.timestamp
      if (seconds !== undefined) painted.push({ at: seconds * 1000, data: frame.data })
      void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
    })
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 95,
      maxWidth: viewport.width * SCALE,
      maxHeight: viewport.height * SCALE,
    })
    // The component at rest is painted before anything changes.
    await page.waitForTimeout(250)
    const change = sequence.set.size > 0
    const updatedArgs = Object.fromEntries(
      [...sequence.set].map(([name, written]) => [name, valueOf(written, Date.now())]),
    )
    // Carried as text and read in the page: a list of rows is deeper than the types of what
    // Playwright carries can follow. The moment of the change is the page's own.
    const asked = await page.evaluate(
      ({ storyId, args, changed }) => {
        if (changed) {
          const channel = Reflect.get(globalThis, '__STORYBOOK_ADDONS_CHANNEL__')
          channel.emit('updateStoryArgs', { storyId, updatedArgs: JSON.parse(args) })
        }
        return performance.timeOrigin + performance.now()
      },
      {
        storyId: sequence.story,
        args: JSON.stringify(updatedArgs),
        changed: change,
      },
    )
    // The catalogue renders a change of arguments when it gets to it, sometimes most of a second
    // later: the sequence starts where the change is painted, not where it was asked. Without a
    // change, it starts at once.
    let from = change ? changeAt(painted, asked) : asked
    for (let waited = 0; from === undefined && waited < 5000; waited += 50) {
      // oxlint-disable-next-line no-await-in-loop -- waiting for the change to be painted
      await page.waitForTimeout(50)
      from = changeAt(painted, asked)
    }
    if (from === undefined) throw new Error('nothing was painted after the change')
    await page.waitForTimeout(sequence.frames * sequence.every + 250)
    await cdp.send('Page.stopScreencast')
    // Each frame is cut to the story's root, as a screenshot of it would be.
    const box = await root.boundingBox()
    const clip = box ?? { x: 0, y: 0, ...viewport }
    const cutter = await browser.newPage({ viewport, deviceScaleFactor: SCALE })
    const chosen = framesAt(painted, from, sequence.frames, sequence.every)
    for (const [index, frame] of chosen.entries()) {
      const name = `frame-${String(index).padStart(2, '0')}.png`
      // oxlint-disable-next-line no-await-in-loop -- one page cuts every frame, one at a time
      await cutter.setContent(
        `<body style="margin:0"><img style="display:block;width:${String(viewport.width)}px" src="data:image/jpeg;base64,${frame.data}"></body>`,
      )
      // oxlint-disable-next-line no-await-in-loop -- one page cuts every frame, one at a time
      writeFileSync(join(sequence.out, name), await cutter.screenshot({ clip }))
    }
    console.log(`${String(sequence.frames)} frames of ${sequence.story} in ${sequence.out}`)
  } finally {
    await browser.close()
  }
}

if (import.meta.main) {
  await record(sequenceOf(process.argv.slice(2)))
}
