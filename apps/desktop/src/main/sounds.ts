/**
 * The three sounds (needs you, error, done): short files shipped with the application, played by
 * main through the system's own player. Never through the window: a sound never takes the focus,
 * and plays the same whether the window is shown, minimised or hidden.
 *
 * In a package the files are unpacked beside the archive (`app.asar.unpacked`), since a player is
 * another program and cannot read inside the archive.
 */

import { execFile } from 'node:child_process'
import { closeSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'

import type { Sound } from '@hemera/ipc'

/** Where the sounds are, beside the bundles, relative to the application. */
export const SOUNDS_FOLDER = 'sounds'

/** The folder of the sounds, from main's own folder: outside the archive in a package. */
export function soundsFolderOf(main: string): string {
  return join(main, '..', '..', SOUNDS_FOLDER).replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked')
}

export const soundFile = (folder: string, sound: Sound): string => join(folder, `${sound}.wav`)

/** The length of a PCM WAV file, read from its header. */
export function wavDurationSeconds(file: string): number {
  const header = Buffer.alloc(44)
  const descriptor = openSync(file, 'r')
  try {
    readSync(descriptor, header, 0, 44, 0)
  } finally {
    closeSync(descriptor)
  }
  const byteRate = header.readUInt32LE(28)
  const dataSize = header.readUInt32LE(40)
  return dataSize / byteRate
}

/** A player run on a file: whether it played it. */
export type PlayerOutcome = 'played' | 'missing' | 'failed'
export type Player = (program: string, args: ReadonlyArray<string>) => Promise<PlayerOutcome>

/** The players to try, in order, on this system. */
export function playersOf(
  platform: NodeJS.Platform,
  file: string,
): ReadonlyArray<readonly [string, ReadonlyArray<string>]> {
  if (platform === 'win32') {
    const quoted = `'${file.replaceAll("'", "''")}'`
    return [
      [
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(New-Object System.Media.SoundPlayer ${quoted}).PlaySync()`,
        ],
      ],
    ]
  }
  if (platform === 'linux') {
    return [
      ['pw-play', [file]],
      ['paplay', [file]],
      ['aplay', ['-q', file]],
    ]
  }
  return []
}

/** Plays a file with the first player that does; false when none could. */
export async function playSound(
  platform: NodeJS.Platform,
  file: string,
  player: Player,
): Promise<boolean> {
  for (const [program, args] of playersOf(platform, file)) {
    // oxlint-disable-next-line no-await-in-loop -- one after the other: the first that plays wins
    if ((await player(program, args)) === 'played') return true
  }
  return false
}

/** How long a player may take: the sounds last under a second. */
const PLAY_LIMIT_MILLIS = 5000

/** The machine's own player, run without a shell or a window. */
export const systemPlayer: Player = (program, args) =>
  new Promise((resolve) => {
    execFile(program, [...args], { timeout: PLAY_LIMIT_MILLIS, windowsHide: true }, (error) => {
      if (error === null) return resolve('played')
      resolve(error.code === 'ENOENT' ? 'missing' : 'failed')
    })
  })
