/**
 * The three sounds, in thirteen styles: shipped with the application, short, and played by main
 * through the system's own player, never through the window, so a sound never takes the focus.
 * Nothing here plays one: the player is a port.
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_SOUND_STYLE, SOUND_STYLES, SOUNDS } from '@hemera/ipc'
import { Effect } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type Player,
  SOUNDS_FOLDER,
  playersOf,
  playSound,
  playStyle,
  previewSound,
  soundFile,
  soundsFolderOf,
  wavDurationSeconds,
} from '../src/main/sounds.ts'

const shipped = join(import.meta.dirname, '..', SOUNDS_FOLDER)

/** Under 100 kB each: the styles are a choice of a few cues, never the whole library. */
const LARGEST_BYTES = 100_000

describe('The sounds Hemera ships', () => {
  test.each(SOUNDS)('%s, in Hemera’s own style, is a file under one second', (sound) => {
    const file = join(shipped, DEFAULT_SOUND_STYLE, `${sound}.wav`)
    expect(statSync(file).size).toBeGreaterThan(0)
    expect(wavDurationSeconds(file)).toBeLessThan(1)
  })

  test('thirteen styles of three sounds, Hemera’s first, and nothing else', () => {
    expect(SOUND_STYLES).toHaveLength(13)
    expect(SOUND_STYLES[0]).toBe('hemera')
    expect(DEFAULT_SOUND_STYLE).toBe('hemera')
    const folders = readdirSync(shipped, { withFileTypes: true })
    expect(
      folders
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([...SOUND_STYLES].sort())
    for (const style of SOUND_STYLES) {
      expect(readdirSync(join(shipped, style)).sort()).toEqual(
        SOUNDS.map((sound) => `${sound}.wav`).sort(),
      )
    }
  })

  test.each(SOUND_STYLES)('every sound of %s is present, a short WAV, under 100 kB', (style) => {
    for (const sound of SOUNDS) {
      const file = join(shipped, style, `${sound}.wav`)
      expect(statSync(file).size).toBeGreaterThan(0)
      expect(statSync(file).size).toBeLessThan(LARGEST_BYTES)
      expect(wavDurationSeconds(file)).toBeGreaterThan(0)
      expect(wavDurationSeconds(file)).toBeLessThan(1.5)
    }
  })

  test('a style’s sound is its own file', () => {
    expect(soundFile('/s', 'glass', 'done', () => true)).toBe(join('/s', 'glass', 'done.wav'))
  })

  test('a missing file falls back to Hemera’s style rather than to silence', () => {
    const present = (file: string) => file.includes(join('/s', 'hemera'))
    expect(soundFile('/s', 'glass', 'error', present)).toBe(join('/s', 'hemera', 'error.wav'))
  })

  test('in a package they are read beside the archive, where a player can reach them', () => {
    expect(soundsFolderOf('/opt/Hemera/resources/app.asar/dist/main')).toBe(
      join('/opt/Hemera/resources/app.asar.unpacked', SOUNDS_FOLDER),
    )
    expect(soundsFolderOf('/work/apps/desktop/dist/main')).toBe(
      join('/work/apps/desktop', SOUNDS_FOLDER),
    )
  })
})

describe('Played by the system’s own player', () => {
  test('on Linux: PipeWire’s or PulseAudio’s, then ALSA’s', () => {
    expect(playersOf('linux', '/s/done.wav').map(([program]) => program)).toEqual([
      'pw-play',
      'paplay',
      'aplay',
    ])
  })

  test('on Windows: the shell’s sound player, the path quoted', () => {
    const [[program, args] = ['', []]] = playersOf('win32', "C:\\Users\\o'brien\\done.wav")
    expect(program).toBe('powershell.exe')
    expect(args.at(-1)).toContain("'C:\\Users\\o''brien\\done.wav'")
  })

  test('a player that is not installed gives way to the next one', async () => {
    const tried: string[] = []
    const player: Player = (program) => {
      tried.push(program)
      return Promise.resolve(program === 'paplay' ? 'played' : 'missing')
    }
    expect(await playSound('linux', '/s/done.wav', player)).toBe(true)
    expect(tried).toEqual(['pw-play', 'paplay'])
  })

  test('the player plays the chosen style’s file, or Hemera’s when it is missing', async () => {
    const files: string[] = []
    const player: Player = (_, args) => {
      files.push(args.at(-1) ?? '')
      return Promise.resolve('played')
    }
    const play = playStyle('linux', '/s', player, (file) => !file.includes('mechanical'))
    expect(await play('glass', 'done')).toBe(true)
    expect(await play('mechanical', 'error')).toBe(true)
    expect(files).toEqual([join('/s', 'glass', 'done.wav'), join('/s', 'hemera', 'error.wav')])
  })

  test('none installed: nothing is heard, and nothing fails', async () => {
    expect(await playSound('linux', '/s/done.wav', () => Promise.resolve('missing'))).toBe(false)
  })
})

describe('A preview plays one sound of one style once, through the same player', () => {
  const previewing = (doNotDisturb: 'on' | 'off' | 'unknown', heard = true) => {
    const played: string[][] = []
    const preview = previewSound({
      doNotDisturb: Effect.succeed(doNotDisturb),
      play: (style, sound) =>
        Effect.sync(() => {
          played.push([style, sound])
          return heard
        }),
    })
    return { played, preview }
  }

  test('the chosen style’s sound, once', async () => {
    const { played, preview } = previewing('off')
    expect(await Effect.runPromise(preview('zen', 'needs-you'))).toBe('played')
    expect(played).toEqual([['zen', 'needs-you']])
  })

  test('Do Not Disturb on: nothing is heard, and the window is told why', async () => {
    const { played, preview } = previewing('on')
    expect(await Effect.runPromise(preview('zen', 'error'))).toBe('do-not-disturb')
    expect(played).toEqual([])
  })

  test('Do Not Disturb unreadable: the window has the focus, so the preview is heard', async () => {
    const { played, preview } = previewing('unknown')
    expect(await Effect.runPromise(preview('glass', 'done'))).toBe('played')
    expect(played).toEqual([['glass', 'done']])
  })

  test('no player on the machine: the window is told so', async () => {
    const { preview } = previewing('off', false)
    expect(await Effect.runPromise(preview('glass', 'done'))).toBe('no-player')
  })
})
