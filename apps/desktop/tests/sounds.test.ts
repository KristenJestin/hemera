/**
 * The three sounds, in thirteen styles: shipped with the application, short, and played by main
 * through the system's own player, never through the window, so a sound never takes the focus.
 * Nothing here plays one: the player is a port.
 */

import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_SOUND_STYLE, DEFAULT_SOUND_VOLUME, SOUND_STYLES, SOUNDS } from '@hemera/ipc'
import { Effect } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type Player,
  SOUNDS_FOLDER,
  playersOf,
  playSound,
  gainOf,
  playStyle,
  previewSound,
  quieterFile,
  quietWav,
  soundFile,
  soundsFolderOf,
  wavDurationSeconds,
} from '../src/main/sounds.ts'
import { removeWithRetries } from './storage.ts'

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
    expect(await play('glass', 'done', 100)).toBe(true)
    expect(await play('mechanical', 'error', 100)).toBe(true)
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
      play: (style, sound, volume) =>
        Effect.sync(() => {
          played.push([style, sound, String(volume)])
          return heard
        }),
    })
    return { played, preview }
  }

  test('the chosen style’s sound, once', async () => {
    const { played, preview } = previewing('off')
    expect(await Effect.runPromise(preview('zen', 'needs-you', 30))).toBe('played')
    expect(played).toEqual([['zen', 'needs-you', '30']])
  })

  test('Do Not Disturb on: nothing is heard, and the window is told why', async () => {
    const { played, preview } = previewing('on')
    expect(await Effect.runPromise(preview('zen', 'error', 30))).toBe('do-not-disturb')
    expect(played).toEqual([])
  })

  test('Do Not Disturb unreadable: the window has the focus, so the preview is heard', async () => {
    const { played, preview } = previewing('unknown')
    expect(await Effect.runPromise(preview('glass', 'done', 30))).toBe('played')
    expect(played).toEqual([['glass', 'done', '30']])
  })

  test('no player on the machine: the window is told so', async () => {
    const { preview } = previewing('off', false)
    expect(await Effect.runPromise(preview('glass', 'done', 30))).toBe('no-player')
  })
})

/** A mono 16-bit WAV of the samples given, with the header the shipped files have. */
const wavOf = (samples: readonly number[]): Buffer => {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + samples.length * 2, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(16000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(samples.length * 2, 40)
  const body = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, at) => body.writeInt16LE(sample, at * 2))
  return Buffer.concat([header, body])
}

const samplesOf = (wav: Buffer): number[] =>
  Array.from({ length: (wav.length - 44) / 2 }, (_, at) => wav.readInt16LE(44 + at * 2))

describe('The volume of the sounds', () => {
  test('half of the slider is a quarter of the amplitude, full is the file as it is', () => {
    expect(DEFAULT_SOUND_VOLUME).toBe(50)
    expect(gainOf(100)).toBe(1)
    expect(gainOf(50)).toBe(0.25)
    expect(gainOf(0)).toBe(0)
  })

  test('a quieter copy keeps the header and scales every sample', () => {
    const wav = wavOf([0, 1000, -1000, 32767, -32768])
    const quiet = quietWav(wav, 50)
    expect(quiet.subarray(0, 44)).toEqual(wav.subarray(0, 44))
    expect(samplesOf(quiet)).toEqual([0, 250, -250, 8192, -8192])
  })

  test('a copy of a shipped sound is written in the folder given, at the volume', () => {
    const folder = mkdtempSync(join(tmpdir(), 'hemera-volume-'))
    try {
      const original = join(shipped, DEFAULT_SOUND_STYLE, 'done.wav')
      const copy = quieterFile(folder)(original, 50)
      expect(copy.startsWith(folder)).toBe(true)
      const before = samplesOf(readFileSync(original))
      const after = samplesOf(readFileSync(copy))
      expect(after).toHaveLength(before.length)
      expect(Math.max(...after.map(Math.abs))).toBeLessThanOrEqual(
        Math.ceil(Math.max(...before.map(Math.abs)) * 0.25),
      )
    } finally {
      removeWithRetries(folder)
    }
  })

  test('at full volume the player gets the file itself', async () => {
    const files: string[] = []
    const player: Player = (_, args) => {
      files.push(args.at(-1) ?? '')
      return Promise.resolve('played')
    }
    const play = playStyle(
      'linux',
      '/s',
      player,
      () => true,
      (file, volume) => `${file}@${volume}`,
    )
    expect(await play('glass', 'done', 100)).toBe(true)
    expect(files).toEqual([join('/s', 'glass', 'done.wav')])
  })

  test('below full the player gets a copy at the volume kept', async () => {
    const files: string[] = []
    const player: Player = (_, args) => {
      files.push(args.at(-1) ?? '')
      return Promise.resolve('played')
    }
    const play = playStyle(
      'linux',
      '/s',
      player,
      () => true,
      (file, volume) => `${file}@${volume}`,
    )
    expect(await play('glass', 'done', 35)).toBe(true)
    expect(files).toEqual([`${join('/s', 'glass', 'done.wav')}@35`])
  })

  test('at zero nothing is played, and nothing fails', async () => {
    const player: Player = () => Promise.reject(new Error('a player was run'))
    const play = playStyle(
      'linux',
      '/s',
      player,
      () => true,
      () => '/never',
    )
    expect(await play('glass', 'done', 0)).toBe(true)
  })
})
