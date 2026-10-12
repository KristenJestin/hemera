/**
 * The prototypes frozen with the Spec, as Building holds them (#235): what the Builder's brief and
 * a helper's say of each one (its verdict, its folder, the files it kept), `prototype_read`, which
 * reads a kept file, and the refusal of a write into a Prototyper's folder.
 *
 * A prototype validated in Planning is part of what was decided, like the Spec: the Builder follows
 * it for the interface. A set-aside one is named as what not to do, an unjudged one as not decided.
 * Its files stay where the Prototyper left them (`missions/<key>/prototypes/<n>/`); they are read
 * there, by their real path, and a path or a link that leads out of that folder is refused.
 * Apart from the Builder's service, so the role registry imports nothing that imports the
 * sessions back.
 */

import { existsSync, realpathSync } from 'node:fs'

import {
  PROTOTYPE_RESULT_NOTE,
  READ_PAGE_BYTES,
  type ToolArguments,
  helperLabel,
  helperNumberOf,
} from '@hemera/core/domain'
import type { FrozenPrototype } from '@hemera/ipc'
import { Cause, Effect, Result } from 'effect'

import { listEvidence } from '../memory/evidence.ts'
import { freezesOf } from '../planning/freeze-store.ts'
import type { Database } from '../storage/database.ts'
import type { Grant } from '../tools/access.ts'
import { type ToolAnswer, answered, attempt, failure, pageSaid, refusal } from '../tools/files.ts'
import { containedIn, resolvePath } from '../tools/paths.ts'
import { readPage } from '../tools/read.ts'
import { helperRowsOf } from './helper-store.ts'

/** A prototype frozen with the Spec, with where its files are and which ones it kept. */
export interface FrozenPrototypeNow extends FrozenPrototype {
  /** Its Prototyper's folder; null when the row of its helper is gone. */
  readonly folder: string | null
  /** The files it kept, relative to its folder. */
  readonly files: ReadonlyArray<string>
}

/** The mission's last Freeze's prototypes, each with its folder and its kept files. */
export const frozenPrototypesOf = (missionId: string) =>
  Effect.gen(function* () {
    const frozen = (yield* freezesOf([missionId])).get(missionId)?.prototypes ?? []
    if (frozen.length === 0) return []
    const rows = yield* helperRowsOf(missionId)
    const evidence = yield* listEvidence(missionId, null)
    return frozen.map((one): FrozenPrototypeNow => {
      const prefix = `${one.helper}/`
      return {
        helper: one.helper,
        question: one.question,
        verdict: one.verdict,
        note: one.note,
        result: one.result,
        folder: rows.find((row) => helperLabel(row.number) === one.helper)?.folder ?? null,
        files: evidence
          .filter((item) => item.about === `helper ${one.helper}` && item.name.startsWith(prefix))
          .map((item) => item.name.slice(prefix.length)),
      }
    })
  })

const VERDICT_SAID = {
  validated: ['validated', 'Reference for the interface: follow it.'],
  'set-aside': ['set aside', 'What not to do: do not follow it.'],
} as const

const UNJUDGED_SAID = [
  'not judged',
  'Not decided: the user did not judge it; neither follow it nor avoid it.',
] as const

/** A prototype's result as the Builder reads it: what it tried, what works, what does not. */
const resultSaid = (result: string): string =>
  result
    .split('\n')
    .filter(
      (line) =>
        line !== PROTOTYPE_RESULT_NOTE &&
        line !== 'Files: none.' &&
        !line.startsWith('Files, kept as evidence:'),
    )
    .join('\n')

const prototypeSaid = (one: FrozenPrototypeNow): string => {
  const [verdict, rule] = one.verdict === null ? UNJUDGED_SAID : VERDICT_SAID[one.verdict]
  return [
    `- ${one.helper} · ${verdict} · ${one.question}`,
    rule,
    one.note === null ? null : `The user said: ${one.note}`,
    one.folder === null ? null : `Folder: ${one.folder}`,
    `Files: ${one.files.length === 0 ? 'none' : one.files.join(', ')}`,
    resultSaid(one.result),
  ]
    .filter((line) => line !== null)
    .join('\n')
    .replaceAll('\n', '\n  ')
}

/** The brief's section on the frozen prototypes; null when the mission froze none. */
export const prototypesSaid = (prototypes: ReadonlyArray<FrozenPrototypeNow>): string | null =>
  prototypes.length === 0
    ? null
    : [
        'Tried in Planning and frozen with the Spec. Read a kept file with prototype_read (prototype, path); you never write one.',
        ...prototypes.map(prototypeSaid),
      ].join('\n')

/** `prototype_read`: one page of a file a frozen prototype kept, inside its folder only. */
export const prototypeReadTool = (
  grant: Grant,
  args: ToolArguments<'prototype_read'>,
  home: string,
): Effect.Effect<ToolAnswer, never, Database> =>
  Effect.gen(function* () {
    if (grant.missionId === null) return refusal('refused: this session has no mission')
    const frozen = yield* frozenPrototypesOf(grant.missionId)
    const number = helperNumberOf(args.prototype)
    const found =
      number === null ? undefined : frozen.find((one) => one.helper === helperLabel(number))
    if (found?.folder === null || found === undefined) {
      const known = frozen.map((one) => one.helper).join(', ')
      return refusal(
        `refused: ${args.prototype} is not a prototype frozen with the Spec: ${known === '' ? 'there is none' : `the frozen ones are ${known}`}`,
      )
    }
    const folder = found.folder
    const resolved = yield* Effect.promise(() => resolvePath(folder, folder, args.path, home))
    if (!resolved.inside || !resolved.certain) {
      return refusal(
        `refused: ${args.path} is not inside the folder of ${found.helper}: only the files it kept can be read`,
      )
    }
    const page = yield* attempt(() =>
      readPage(resolved.path, args.range?.offset ?? 0, args.range?.length ?? READ_PAGE_BYTES),
    ).pipe(Effect.result)
    return Result.isFailure(page)
      ? failure(`could not read ${args.path}: ${page.failure}`)
      : answered(pageSaid(page.success))
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.succeed(failure(`the call failed: ${Cause.pretty(cause).split('\n')[0] ?? ''}`)),
    ),
  )

/**
 * Why a write of the Building at this (resolved) path is refused when it lands in a Prototyper's
 * folder; null otherwise. A frozen prototype is read, never written, whoever asks.
 */
export const prototypeWriteRefusal = (missionId: string, path: string) =>
  Effect.gen(function* () {
    const rows = (yield* helperRowsOf(missionId)).filter((row) => row.place === 'prototype')
    const real = (folder: string): string => (existsSync(folder) ? realpathSync(folder) : folder)
    const inside = rows.find(
      (row) => containedIn(row.folder, path) || containedIn(real(row.folder), path),
    )
    return inside === undefined
      ? null
      : `refused: that file is in the folder of ${helperLabel(inside.number)}, a prototype frozen with the Spec: read it with prototype_read, never write it.`
  })
