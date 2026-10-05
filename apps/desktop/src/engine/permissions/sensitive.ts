/**
 * The sensitive places, for file tools, command arguments and workflow tools alike: the list of
 * `@hemera/core` (credentials, keys, every `.env`), and Hemera's actual data folder wherever it
 * is, with the narrow exemption of CT-17.
 *
 * Below the session's own place (a Workspace Hemera made in its data folder, a Probe's folder),
 * only what sits below counts: a `.env` there is sensitive, the place itself is not. In the data
 * folder, `missions/<key>/` is the session's mission's own, and `missions/<key>/` of an accepted
 * dependency may be read; everything else (other missions, their evidence and checkpoints,
 * `snapshots/`, other Workspaces) is a sensitive place. Paths are the caller's, links resolved.
 */

import { realpathSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { sensitivePlace, shownFromHome } from '@hemera/core/domain'
import { Effect, Layer } from 'effect'

import { ProfileHome } from '../profile-home.ts'
import { containedIn } from '../tools/paths.ts'
import { SensitivePlaces } from '../tools/ports.ts'
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

export const sensitivePlacesLayer = (settings: PlacesSettings) =>
  Layer.effect(
    SensitivePlaces,
    Effect.gen(function* () {
      const { dataFolder } = yield* ProfileHome
      const places = yield* MissionPlaces
      const context = { home: settings.home, platform: settings.platform }
      const said = (place: string) => `sensitive place: ${place}`
      /** The sensitive place below a folder, shown from the home with the folder before it. */
      const below = (root: string, path: string) => {
        const found = sensitivePlace(relative(root, path), context)
        return found === null ? null : said(shownFromHome(join(root, found), context))
      }
      const dataFolders = spellings(dataFolder)
      return {
        sensitive: (path, asked) =>
          Effect.gen(function* () {
            const root = spellings(asked.session.place.root).find((one) => containedIn(one, path))
            if (root !== undefined) return below(root, path)
            const data = dataFolders.find((one) => containedIn(one, path))
            if (data === undefined) {
              const found = sensitivePlace(path, context)
              return found === null ? null : said(found)
            }
            const [first = '', second = ''] = relative(data, path).split(sep)
            if (first === 'missions' && second !== '' && asked.session.missionId !== null) {
              const folders = yield* places.foldersOf(asked.session.missionId)
              const reachable =
                second === folders.own || (!asked.writes && folders.dependencies.includes(second))
              if (reachable) return below(join(data, first, second), path)
            }
            const shown = join(data, ...[first, second].filter((one) => one !== ''))
            return said(shownFromHome(shown, context))
          }),
      }
    }),
  )
