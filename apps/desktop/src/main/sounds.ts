/**
 * The three sounds (needs you, error, done): short files shipped with the application, one folder
 * per sound style, played by main through the system's own player. Never through the window: a
 * sound never takes the focus, and plays the same whether the window is shown, minimised or hidden.
 * WAV everywhere, since Windows' player reads nothing else.
 *
 * The volume is Hemera's own, applied to the samples and not asked of the player: `pw-play` and
 * `paplay` have a volume flag, `aplay` and Windows' player have none. Below full, the player is
 * handed a quieter copy of the file, written in the temporary folder.
 *
 * In a package the files are unpacked beside the archive (`app.asar.unpacked`), since a player is
 * another program and cannot read inside the archive.
 */

import { execFile } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import {
  DEFAULT_SOUND_STYLE,
  type Sound,
  type SoundPreview,
  type SoundStyle,
  type SoundVolume,
} from '@hemera/ipc'
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

/** The header of a PCM WAV file: the samples follow it. */
const WAV_HEADER_BYTES = 44

/**
 * What a volume multiplies the samples by. The ear hears amplitude on a curve, so the slider
 * squares it: half of the slider is a quarter of the amplitude, about 12 dB under the file.
 */
export const gainOf = (volume: SoundVolume): number => (volume / 100) ** 2

/** A PCM 16-bit WAV with its samples scaled to the volume, its header untouched. */
export function quietWav(wav: Buffer, volume: SoundVolume): Buffer {
  const quiet = Buffer.from(wav)
  const gain = gainOf(volume)
  for (let at = WAV_HEADER_BYTES; at + 1 < quiet.length; at += 2) {
    quiet.writeInt16LE(Math.round(quiet.readInt16LE(at) * gain), at)
  }
  return quiet
}

/** Where the quieter copies are written, and how a file at a volume is turned into one. */
export type Quieter = (file: string, volume: SoundVolume) => string

/** A copy of a sound at a volume, written in the folder given, named after the sound. */
export const quieterFile =
  (folder: string): Quieter =>
  (file, volume) => {
    mkdirSync(folder, { recursive: true })
    const copy = join(
      folder,
      `${basename(dirname(file))}-${basename(file, '.wav')}-${String(volume)}.wav`,
    )
    writeFileSync(copy, quietWav(readFileSync(file), volume))
    return copy
  }

/**
 * Plays a sound in a style at a volume with the first player that does; false when none could.
 * Full volume plays the file itself, none plays nothing, and nothing failed.
 */
export const playStyle =
  (
    platform: NodeJS.Platform,
    folder: string,
    player: Player,
    exists: (file: string) => boolean = existsSync,
    quieter: Quieter = quieterFile(join(tmpdir(), 'hemera-sounds')),
  ) =>
  (style: SoundStyle, sound: Sound, volume: SoundVolume): Promise<boolean> => {
    if (volume === 0) return Promise.resolve(true)
    const file = soundFile(folder, style, sound, exists)
    return playSound(platform, volume === 100 ? file : quieter(file, volume), player)
  }

export interface PreviewPorts {
  readonly doNotDisturb: Effect.Effect<DoNotDisturb>
  /** Plays the sound in the style at the volume: whether a player did. */
  readonly play: (style: SoundStyle, sound: Sound, volume: SoundVolume) => Effect.Effect<boolean>
}

/**
 * One sound of one style at a volume, played once, as a notification's would be. The window asking has the
 * focus, so it is the in-app rule: Do Not Disturb on keeps it quiet, unreadable lets it be heard.
 */
export const previewSound =
  (ports: PreviewPorts) =>
  (style: SoundStyle, sound: Sound, volume: SoundVolume): Effect.Effect<SoundPreview> =>
    Effect.gen(function* () {
      if ((yield* ports.doNotDisturb) === 'on') return 'do-not-disturb'
      return (yield* ports.play(style, sound, volume)) ? 'played' : 'no-player'
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
