/**
 * The three sounds: shipped with the application, short, and played by main through the system's
 * own player, never through the window, so a sound never takes the focus. Nothing here plays one:
 * the player is a port.
 */

import { statSync } from 'node:fs'
import { join } from 'node:path'

import { SOUNDS } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  type Player,
  SOUNDS_FOLDER,
  playersOf,
  playSound,
  soundsFolderOf,
  wavDurationSeconds,
} from '../src/main/sounds.ts'

const shipped = join(import.meta.dirname, '..', SOUNDS_FOLDER)

describe('The sounds Hemera ships', () => {
  test.each(SOUNDS)('%s is a file under one second', (sound) => {
    const file = join(shipped, `${sound}.wav`)
    expect(statSync(file).size).toBeGreaterThan(0)
    expect(wavDurationSeconds(file)).toBeLessThan(1)
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

  test('none installed: nothing is heard, and nothing fails', async () => {
    expect(await playSound('linux', '/s/done.wav', () => Promise.resolve('missing'))).toBe(false)
  })
})
