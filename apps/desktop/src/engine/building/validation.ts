/**
 * The validation settings a Building judges its result with (CT-34): copied into the mission at
 * launch, one version per copy, and read from that copy for the whole Building, its rounds and its
 * fixes; a change of the Project afterwards does not touch it.
 *
 * The copy is made of **sections**, each registered here by the ticket that owns it with the
 * function that reads the Project's current value and the Schema it is encoded with. This version
 * registers the catalogue lines the Spec's proofs name (#7), the exclusive resources (#88), the
 * check model with the exact catalogue lines its checks use (#143), and the "who commits" rule,
 * which reads "Hemera does not commit during Building" until its owner registers the rule itself.
 * The doc recipes (#146) come with theirs.
 * The safety rules (the "never" list, the sensitive places, "ask before running") are never copied:
 * they always apply in their current version (#36, #37).
 */

import { createHash } from 'node:crypto'

import { ProjectCheck } from '@hemera/core/domain'
import { CommandDraft, ExclusiveResource, type Spec } from '@hemera/ipc'
import { desc, eq } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import { listCommands } from '../catalogue.ts'
import { listChecks } from '../project-checks.ts'
import { getProject } from '../projects.ts'
import { listResources } from '../resources/declarations.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { missionValidationSettings } from '../storage/schema.ts'

/** What a section reads its value from: the mission's Project and its frozen Spec. */
export interface SectionSource {
  readonly projectId: string
  readonly spec: Spec
}

/** One section of the copy: its id, and its current value in the Project, encoded. */
export interface ValidationSection {
  readonly id: string
  readonly read: (source: SectionSource) => Effect.Effect<Schema.Json, unknown, Database>
}

/** A catalogue line as the copy keeps it: every system's line, and what it may write. */
const CatalogueLine = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  line: CommandDraft.fields.line,
  lineWindows: CommandDraft.fields.lineWindows,
  lineLinux: CommandDraft.fields.lineLinux,
  writeGlobs: CommandDraft.fields.writeGlobs,
})
const encodeLines = Schema.encodeSync(Schema.toCodecJson(Schema.Array(CatalogueLine)))

/** What the Spec's proofs run: a catalogue command's id or name, or a line of their own. */
const proofCommands = (spec: Spec): ReadonlySet<string> =>
  new Set(
    spec.requirements.flatMap((requirement) =>
      requirement.scenarios.flatMap((scenario) =>
        scenario.proof === null
          ? []
          : [scenario.proof.test?.command, scenario.proof.command].flatMap((one) =>
              one === undefined ? [] : [one.trim()],
            ),
      ),
    ),
  )

/** The exact line of every catalogue command the Spec's proofs name (#7). */
const CATALOGUE: ValidationSection = {
  id: 'catalogue',
  read: ({ projectId, spec }) =>
    Effect.gen(function* () {
      const named = proofCommands(spec)
      const commands = yield* listCommands(projectId)
      return encodeLines(
        commands
          .filter((one) => named.has(one.id) || named.has(one.name))
          .map((one) => ({
            id: one.id,
            name: one.name,
            line: one.line,
            lineWindows: one.lineWindows,
            lineLinux: one.lineLinux,
            writeGlobs: one.writeGlobs,
          })),
      )
    }),
}

/**
 * A catalogue line as a check runs it from the copy: every system's line, its type and marks, and
 * where the catalogue puts it (its repository's path, null for the root, and its folder there).
 */
export const CheckLine = Schema.Struct({
  ...CatalogueLine.fields,
  type: CommandDraft.fields.type,
  readOnly: CommandDraft.fields.readOnly,
  repository: Schema.NullOr(Schema.String),
  folder: CommandDraft.fields.folder,
})
export type CheckLine = typeof CheckLine.Type

/** The check model as a mission keeps it (#143): the checks, and the catalogue lines they run. */
export const ChecksCopy = Schema.Struct({
  checks: Schema.Array(ProjectCheck),
  lines: Schema.Array(CheckLine),
})
export type ChecksCopy = typeof ChecksCopy.Type

const encodeChecks = Schema.encodeSync(Schema.toCodecJson(ChecksCopy))
const readChecks = Schema.decodeUnknownOption(Schema.toCodecJson(ChecksCopy))

/** The Project's checks, and the exact line of every catalogue command they run. */
const CHECKS: ValidationSection = {
  id: 'checks',
  read: ({ projectId }) =>
    Effect.gen(function* () {
      const project = yield* getProject(projectId)
      const checks = yield* listChecks(projectId)
      const used = new Set(checks.flatMap((one) => (one.commandId === null ? [] : [one.commandId])))
      const commands = yield* listCommands(projectId)
      return encodeChecks({
        checks,
        lines: commands
          .filter((one) => used.has(one.id))
          .map((one) => ({
            id: one.id,
            name: one.name,
            line: one.line,
            lineWindows: one.lineWindows,
            lineLinux: one.lineLinux,
            writeGlobs: one.writeGlobs,
            type: one.type,
            readOnly: one.readOnly,
            repository:
              project.repositories.find((repository) => repository.id === one.repositoryId)?.path ??
              null,
            folder: one.folder,
          })),
      })
    }),
}

/** The reader of the check model's section: none in a copy taken before it existed. */
export const checksOf = (sections: Sections): ChecksCopy =>
  Option.getOrElse(readChecks(sections[CHECKS.id]), () => ({ checks: [], lines: [] }))

const encodeResources = Schema.encodeSync(Schema.toCodecJson(Schema.Array(ExclusiveResource)))

/** The Project's exclusive resources as declared (#88). */
const RESOURCES: ValidationSection = {
  id: 'resources',
  read: ({ projectId }) => Effect.map(listResources(projectId), encodeResources),
}

/** Who commits during Building, until the rule's owner registers it. */
export const HEMERA_DOES_NOT_COMMIT = 'Hemera does not commit during Building'

const COMMITS: ValidationSection = {
  id: 'commits',
  read: () => Effect.succeed(HEMERA_DOES_NOT_COMMIT),
}

/**
 * The value of the "who commits" section that asks for one commit per task (#142, open question
 * 26), with the commit message's template (`{key}`, `{task}`, `{title}`). Its owner (R5) writes it
 * into the copy; until then no copy holds it, which reads as "at push": no commit in Building.
 */
export const CommitPerTask = Schema.Struct({
  perTask: Schema.Literal(true),
  template: Schema.String,
})
export type CommitPerTask = typeof CommitPerTask.Type

export const ONE_COMMIT_PER_TASK: CommitPerTask = {
  perTask: true,
  template: '{key} {task}: {title}',
}

const readCommitPerTask = Schema.decodeUnknownOption(CommitPerTask)

/** The reader of the "who commits" section: one commit per task and its template, or null. */
export const commitRuleOf = (sections: Sections): CommitPerTask | null =>
  Option.getOrNull(readCommitPerTask(sections[COMMITS.id]))

/** The sections this version copies, in their order. */
export const VALIDATION_SECTIONS: ReadonlyArray<ValidationSection> = [
  CATALOGUE,
  RESOURCES,
  CHECKS,
  COMMITS,
]

/** Each section's value in the Project now. */
export type Sections = Readonly<Record<string, Schema.Json>>

/** The Project's current value of every section, for a mission's frozen Spec. */
export const sectionsNow = (source: SectionSource) =>
  Effect.gen(function* () {
    const sections: Record<string, Schema.Json> = {}
    for (const section of VALIDATION_SECTIONS) {
      sections[section.id] = yield* section.read(source)
    }
    return sections
  })

/** What a check records of the settings it saw: a fingerprint of every section's value. */
export const fingerprintOf = (sections: Sections): string =>
  createHash('sha256').update(JSON.stringify(sections)).digest('hex')

const SectionsJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json))
const readSections = Schema.decodeUnknownOption(SectionsJson)
export const writeSections = Schema.encodeSync(SectionsJson)

/** The mission's copy, its latest version; null before its first launch. */
export const validationSettingsOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(missionValidationSettings)
      .where(eq(missionValidationSettings.missionId, missionId))
      .orderBy(desc(missionValidationSettings.version))
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('reading the validation settings')))
    if (row === undefined) return null
    return {
      version: row.version,
      takenAt: row.takenAt,
      sections: Option.getOrElse(readSections(row.sections), (): Sections => ({})),
    }
  })

/** The copy taken at launch, written as the mission's next version, in the launch's transaction. */
export const copyIn = (transaction: EngineTransaction, missionId: string, sections: string) =>
  Effect.gen(function* () {
    const [last] = yield* transaction
      .select({ version: missionValidationSettings.version })
      .from(missionValidationSettings)
      .where(eq(missionValidationSettings.missionId, missionId))
      .orderBy(desc(missionValidationSettings.version))
      .limit(1)
      .pipe(Effect.mapError(refusedWhile('reading the validation settings')))
    const version = (last?.version ?? 0) + 1
    yield* transaction
      .insert(missionValidationSettings)
      .values({ missionId, version, takenAt: new Date().toISOString(), sections })
      .pipe(Effect.mapError(refusedWhile('copying the validation settings')))
    return version
  })
