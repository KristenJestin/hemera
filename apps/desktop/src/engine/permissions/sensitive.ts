/**
 * The sensitive places, for file tools, command arguments and workflow tools alike: the list of
 * `@hemera/core` (credentials, keys, every `.env` but the templates a read tool reads), and
 * Hemera's actual data folder wherever it is, with the narrow exemption of CT-17.
 *
 * Below the session's own place (a Workspace Hemera made in its data folder, a Probe's folder),
 * only what sits below counts: a `.env` there is sensitive, the place itself is not. In the data
 * folder, `missions/<key>/` is the session's mission's own, and `missions/<key>/` of an accepted
 * dependency may be read; everything else (other missions, their evidence and checkpoints,
 * `snapshots/`, other Workspaces) is a sensitive place. Paths are the caller's, links resolved.
 *
 * A file read under the session's place with more than one name on the disk (a hard link) is
 * compared with the sensitive files of that place, found by their names: one that is one of them
 * is that sensitive place (#392). A hard link from the place to a sensitive file outside it is
 * not seen: the residual #380 accepted. A mission's evidence is named by its fingerprint: one
 * Hemera kept from a file now a sensitive place (`H1/.env`, kept before #392) is that place.
 */

import { type BigIntStats, realpathSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

import { sensitivePlace, shownFromHome } from '@hemera/core/domain'
import { Effect, Layer, Predicate } from 'effect'

import { ProfileHome } from '../profile-home.ts'
import { containedIn } from '../tools/paths.ts'
import { type LinkedFiles, type PlaceAsked, SensitivePlaces } from '../tools/ports.ts'
import { MissionPlaces } from './ports.ts'

export interface PlacesSettings {
  /** What `~` stands for. */
  readonly home: string
  readonly platform: string
}

/** A folder as it is written, and as the disk has it when it can say. */
const spellings = (folder: string): ReadonlyArray<string> => {
  try {
    const real = realpathSync.native(folder)
    return real === folder ? [folder] : [folder, real]
  } catch {
    return [folder]
  }
}

/**
 * The folders a place's sensitive files are not looked for in: Git's own, and those a package
 * manager fills with hard links of its own (npm and pnpm, Cargo, uv).
 */
const NOT_LOOKED_IN = new Set(['.git', 'node_modules', 'target', '.venv'])

/** A file's identity on the disk, the same for each of its names. */
const identityOf = (file: BigIntStats) => `${String(file.dev)}:${String(file.ino)}`

/** The code of a system error, when it has one. */
const codeOf = (cause: Error): string | undefined =>
  'code' in cause && Predicate.isString(cause.code) ? cause.code : undefined

/**
 * The files below `root` that `sensitive` names and that have another name on the disk, by their
 * identity: what a hard link may be a second name of. A folder that cannot be read (but one gone
 * meanwhile) may hold one: it is named, and the files are not known.
 */
async function linkedSensitiveFiles(
  root: string,
  sensitive: (path: string) => string | null,
): Promise<LinkedFiles> {
  const found = new Map<string, string>()
  let unread: string | null = null
  const lookIn = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true }).catch((cause: Error) => {
      if (codeOf(cause) !== 'ENOENT') unread ??= folder
      return []
    })
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(folder, entry.name)
        if (entry.isDirectory()) {
          if (!NOT_LOOKED_IN.has(entry.name)) await lookIn(path)
          return
        }
        const place = entry.isFile() ? sensitive(path) : null
        if (place === null) return
        const file = await stat(path, { bigint: true }).catch(() => null)
        if (file !== null && file.nlink > 1n) found.set(identityOf(file), place)
      }),
    )
  }
  await lookIn(root)
  return { files: found, unread }
}

export const sensitivePlacesLayer = (settings: PlacesSettings) =>
  Layer.effect(
    SensitivePlaces,
    Effect.gen(function* () {
      const { dataFolder } = yield* ProfileHome
      const places = yield* MissionPlaces
      const context = { home: settings.home, platform: settings.platform }
      // A place under the home is shown from it with forward slashes, as `outside` shows it.
      const said = (place: string) =>
        `sensitive place: ${place.startsWith('~') ? place.replaceAll('\\', '/') : place}`
      /** The sensitive place below a folder, shown from the home with the folder before it. */
      const below = (root: string, path: string, reading: boolean) => {
        const found = sensitivePlace(relative(root, path), context, { reading })
        return found === null ? null : said(shownFromHome(join(root, found), context))
      }
      /**
       * The sensitive place a file read below `root` is under another of its names, or null: a
       * file with one name, or whose other names are no sensitive file of `root`, is none.
       */
      const linkedBelow = (root: string, path: string, asked: PlaceAsked) =>
        Effect.promise(async () => {
          if (asked.writes || !isAbsolute(path)) return null
          const file = await stat(path, { bigint: true }).catch(() => null)
          if (file === null || !file.isFile() || file.nlink < 2n) return null
          const find = () => linkedSensitiveFiles(root, (one) => below(root, one, true))
          const { files, unread } = await (asked.links?.below(root, find) ?? find())
          const place =
            files.get(identityOf(file)) ??
            (unread === null ? null : `${said(shownFromHome(unread, context))} could not be read`)
          return place === null ? null : `${place}, through a hard link`
        })
      /** The sensitive place below a folder, by a path's names, then by its other names. */
      const belowOrLinked = (root: string, path: string, asked: PlaceAsked) => {
        const named = below(root, path, !asked.writes)
        return named === null ? linkedBelow(root, path, asked) : Effect.succeed(named)
      }
      const dataFolders = spellings(dataFolder)
      return {
        sensitive: (path, asked) =>
          Effect.gen(function* () {
            const reading = !asked.writes
            const root = spellings(asked.session.place.root).find((one) => containedIn(one, path))
            if (root !== undefined) return yield* belowOrLinked(root, path, asked)
            // The Workspace a place reads beside its own folder, for a read only (#145).
            const readable = asked.session.place.readable
            const read =
              reading && readable !== undefined
                ? spellings(readable).find((one) => containedIn(one, path))
                : undefined
            if (read !== undefined) return yield* belowOrLinked(read, path, asked)
            const data = dataFolders.find((one) => containedIn(one, path))
            if (data === undefined) {
              const found = sensitivePlace(path, context, { reading })
              return found === null ? null : said(found)
            }
            const [first = '', second = '', third = '', fourth = ''] = relative(data, path).split(
              sep,
            )
            if (first === 'missions' && second !== '' && asked.session.missionId !== null) {
              const folders = yield* places.foldersOf(asked.session.missionId)
              const reachable =
                second === folders.own || (!asked.writes && folders.dependencies.includes(second))
              if (reachable) {
                const named = below(join(data, first, second), path, reading)
                if (named !== null || third !== 'evidence' || fourth === '') return named
                const kept = yield* places.evidenceNamed(second, fourth)
                const from = kept === null ? null : sensitivePlace(kept, context, { reading })
                return from === null ? null : said(`evidence kept from ${kept ?? ''}`)
              }
            }
            const shown = join(data, ...[first, second].filter((one) => one !== ''))
            return said(shownFromHome(shown, context))
          }),
      }
    }),
  )
