/**
 * The three sounds (needs you, error, done): short files shipped with the application, one folder
 * per sound style, played by main through the system's own player. Never through the window: a
 * sound never takes the focus, and plays the same whether the window is shown, minimised or hidden.
 * WAV everywhere, since Windows' player reads nothing else.
 *
 * In a package the files are unpacked beside the archive (`app.asar.unpacked`), since a player is
 * another program and cannot read inside the archive.
 */

import { execFile } from 'node:child_process'
import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_SOUND_STYLE, type Sound, type SoundPreview, type SoundStyle } from '@hemera/ipc'
import { Effect } from 'effect'

import type { DoNotDisturb } from './notifications.ts'

/** Where the sounds are, beside the bundles, relative to the application. */
export const SOUNDS_FOLDER = 'sounds'

/** The folder of the sounds, from main's own folder: outside the archive in a package. */
export function soundsFolderOf(main: string): string {
  return join(main, '..', '..', SOUNDS_FOLDER).replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked')
}

/** A style's file of a sound, or Hemera's own when that style lacks it: never silence instead. */
export function soundFile(
  folder: string,
  style: SoundStyle,
  sound: Sound,
  exists: (file: string) => boolean = existsSync,
): string {
  const chosen = join(folder, style, `${sound}.wav`)
  return exists(chosen) ? chosen : join(folder, DEFAULT_SOUND_STYLE, `${sound}.wav`)
}

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

/** Plays a sound in a style with the first player that does; false when none could. */
export const playStyle =
  (
    platform: NodeJS.Platform,
    folder: string,
    player: Player,
    exists: (file: string) => boolean = existsSync,
  ) =>
  (style: SoundStyle, sound: Sound): Promise<boolean> =>
    playSound(platform, soundFile(folder, style, sound, exists), player)

export interface PreviewPorts {
  readonly doNotDisturb: Effect.Effect<DoNotDisturb>
  /** Plays the sound in the style: whether a player did. */
  readonly play: (style: SoundStyle, sound: Sound) => Effect.Effect<boolean>
}

/**
 * One sound of one style, played once, as a notification's would be. The window asking has the
 * focus, so it is the in-app rule: Do Not Disturb on keeps it quiet, unreadable lets it be heard.
 */
export const previewSound =
  (ports: PreviewPorts) =>
  (style: SoundStyle, sound: Sound): Effect.Effect<SoundPreview> =>
    Effect.gen(function* () {
      if ((yield* ports.doNotDisturb) === 'on') return 'do-not-disturb'
      return (yield* ports.play(style, sound)) ? 'played' : 'no-player'
    })

/** How long a player may take: the sounds last under a second and a half. */
const PLAY_LIMIT_MILLIS = 5000

/** The machine's own player, run without a shell or a window. */
export const systemPlayer: Player = (program, args) =>
  new Promise((resolve) => {
    execFile(program, [...args], { timeout: PLAY_LIMIT_MILLIS, windowsHide: true }, (error) => {
      if (error === null) return resolve('played')
      resolve(error.code === 'ENOENT' ? 'missing' : 'failed')
    })
  })
