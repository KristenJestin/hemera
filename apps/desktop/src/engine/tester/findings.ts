/**
 * The tester mode's findings (#45): files in a folder of the data folder, and nothing in the
 * database, nothing sent anywhere.
 *
 * `<data folder>/tester/findings/<number>-<slug>.md` holds one finding each, a front matter over a
 * Markdown body, and `<data folder>/tester/README.md` is the index, written again after every
 * change. A report is read against the files as they stand: the same kind, the same place and a
 * similar title is one more occurrence of that file, anything else a new file. The folder is the
 * whole state: a file the user deletes is a finding gone, one they edit is read as they left it.
 * The files are the user's: no class of retention rotates them.
 *
 * Every write goes to a file beside its target and is renamed over it, so a reader never sees half
 * a file, and the reports of every session go one at a time: two agents reporting one problem at
 * once are two occurrences of one finding, never two findings or one lost count.
 *
 * What a finding holds is masked here, at the one place it is written (#35): the known secrets by
 * their value, the secrets' shapes, and an argument field that looks like a credential, whole.
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  FINDING_KINDS,
  FINDING_SEVERITIES,
  type Finding,
  type FindingContext,
  type FindingHead,
  type ReportedFinding,
  findingFileName,
  findingsIndex,
  matchingFinding,
  newFinding,
  recordOccurrence,
  writeFindingFile,
} from '@hemera/core/domain'
import { Context, Effect, Layer, Option, Predicate, Schema, Semaphore } from 'effect'

import { Secrets } from '../secrets.ts'

/** The tester's folder in a data folder, its findings' folder, and its index. */
export const TESTER_FOLDER = 'tester'
export const FINDINGS_FOLDER = 'findings'
export const TESTER_INDEX = 'README.md'
/** The highest number a finding ever took, so one the user deleted is never taken again. */
export const LAST_NUMBER = '.last-number'

export const testerFolderOf = (dataFolder: string): string => join(dataFolder, TESTER_FOLDER)

/** The folder could not be read or written. */
export class TesterFilesFailed extends Schema.TaggedError<TesterFilesFailed>()(
  'TesterFilesFailed',
  { doing: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `The tester folder refused while ${this.doing}: ${this.reason}`
  }
}

/** A finding as its file holds it, and the name of that file. */
export interface FindingFile extends Finding {
  readonly file: string
}

/** What a report became: a new finding, or one more occurrence of one. */
export interface ReportAnswer {
  readonly number: number
  readonly added: boolean
  readonly occurrences: number
  readonly file: string
  readonly title: string
}

export class TesterFindings extends Context.Service<
  TesterFindings,
  {
    /** The folder, `<data folder>/tester`. */
    readonly folder: string
    /** What this Hemera is, as every occurrence records it. */
    readonly hemera: FindingContext['hemera']
    /** Records a report, masked, against the findings as they stand; then writes the index. */
    readonly report: (
      reported: ReportedFinding,
      context: FindingContext,
    ) => Effect.Effect<ReportAnswer, TesterFilesFailed>
    /** Every finding of the folder, the latest seen first. */
    readonly list: Effect.Effect<ReadonlyArray<FindingFile>, TesterFilesFailed>
  }
>()('TesterFindings') {}

const Text = Schema.String
const MaybeText = Schema.NullOr(Schema.String)
const Texts = Schema.Array(Schema.String)

/** The front matter a finding needs to be one, as the JSON values of its lines decode. */
const Front = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  title: Schema.String.check(Schema.isNonEmpty()),
  kind: Schema.Literals(FINDING_KINDS),
  place: Text,
  severity: Schema.Literals(FINDING_SEVERITIES),
  occurrences: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  first_seen: Text,
  last_seen: Text,
  missions: Texts,
  roles: Texts,
  version: Text,
  channel: Text,
  commit: MaybeText,
  os: Text,
  agent: Text,
  agent_version: MaybeText,
  model: MaybeText,
  effort: MaybeText,
})
const readFront = Schema.decodeUnknownOption(Front)
const readValue = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json))

/** What a key that a hand removed reads as, so the finding still reads. */
const MISSING = {
  occurrences: 1,
  first_seen: '',
  last_seen: '',
  missions: [],
  roles: [],
  version: '',
  channel: '',
  commit: null,
  os: '',
  agent: '',
  agent_version: null,
  model: null,
  effort: null,
  place: '',
} satisfies Schema.JsonObject

/** A finding read back from its file, or null for a file that is not one. */
export function readFindingFile(written: string): Finding | null {
  const lines = written.replace(/\r\n/g, '\n')
  if (!lines.startsWith('---\n')) return null
  const end = lines.indexOf('\n---\n', 3)
  if (end < 0) return null
  const keys = lines
    .slice(4, end)
    .split('\n')
    .flatMap((line) => {
      const colon = line.indexOf(':')
      if (colon <= 0) return []
      const raw = line.slice(colon + 1).trim()
      return [[line.slice(0, colon).trim(), Option.getOrElse(readValue(raw), () => raw)] as const]
    })
  return Option.match(readFront({ ...MISSING, ...Object.fromEntries(keys) }), {
    onNone: () => null,
    onSome: (front) => {
      const head: FindingHead = {
        number: front.number,
        title: front.title,
        kind: front.kind,
        place: front.place,
        severity: front.severity,
        occurrences: front.occurrences,
        firstSeen: front.first_seen,
        lastSeen: front.last_seen,
        missions: front.missions,
        roles: front.roles,
        version: front.version,
        channel: front.channel,
        commit: front.commit,
        os: front.os,
        agent: front.agent,
        agentVersion: front.agent_version,
        model: front.model,
        effort: front.effort,
      }
      return { head, body: lines.slice(end + 5) }
    },
  })
}

/**
 * When a finding was seen, as an instant: two offsets (a change of the clocks) never order it by
 * their text. A date a hand removed or broke reads as the oldest.
 */
const instantOf = (at: string): number => Date.parse(at) || 0

/** Where a finding's number is read from its file's name, whatever its front matter says. */
const NUMBERED = /^(\d+)-.*\.md$/

/**
 * The commit a version was described from, when it was: a development run is `git describe`'s
 * `1.0.0-dev.3-g1a2b3c4`; a packaged one carries no commit.
 */
export const commitOf = (version: string): string | null =>
  /-g([0-9a-f]{7,40})$/.exec(version)?.[1] ?? null

/** What the engine that writes the findings is: its data folder, its version and its channel. */
export interface TesterIdentity {
  readonly dataFolder: string
  readonly version: string
  readonly channel: string
  readonly os: string
}

/** How a file is renamed over another: the system's own, unless a test says otherwise. */
export interface TesterFiles {
  readonly rename: (from: string, to: string) => Promise<void>
}

/** What a rename refused for a moment says: an editor or a scanner holds the file (Windows). */
const HELD_OPEN = new Set(['EPERM', 'EACCES', 'EBUSY'])
/** How often a rename refused for a moment is tried, and how long apart. */
const RENAME_TRIES = 5
const RENAME_PAUSE_MS = 50

/** The findings of a data folder, on files, written one report at a time. */
export const testerFindingsLayer = (identity: TesterIdentity, system: TesterFiles = { rename }) =>
  Layer.effect(
    TesterFindings,
    Effect.gen(function* () {
      const secrets = yield* Secrets
      const folder = testerFolderOf(identity.dataFolder)
      const findings = join(folder, FINDINGS_FOLDER)
      const writing = yield* Semaphore.make(1)

      const attempt = <A>(doing: string, run: () => Promise<A>) =>
        Effect.tryPromise({
          try: run,
          catch: (cause) =>
            new TesterFilesFailed({
              doing,
              reason: cause instanceof Error ? cause.message : String(cause),
            }),
        })

      /**
       * A rename over a file that Windows refuses while another program holds it open (an editor
       * on the README), tried again a few times before the refusal is said.
       */
      const renamedOver = (from: string, to: string, tried = 1): Promise<void> =>
        system.rename(from, to).catch(async (cause: unknown) => {
          const held = Predicate.hasProperty(cause, 'code') && HELD_OPEN.has(String(cause.code))
          if (!held || tried >= RENAME_TRIES) throw cause
          await new Promise((done) => setTimeout(done, RENAME_PAUSE_MS * tried))
          return renamedOver(from, to, tried + 1)
        })

      /** A file replaced whole: written beside it, then renamed over it. */
      const replaced = (path: string, content: string) =>
        attempt(`writing ${path}`, async () => {
          const beside = `${path}.${crypto.randomUUID()}.tmp`
          try {
            await writeFile(beside, content, 'utf8')
            await renamedOver(beside, path)
          } catch (cause) {
            await rm(beside, { force: true })
            throw cause
          }
        })

      /** The names of the findings' files; none before the first report. */
      const names = attempt('listing the findings', () =>
        readdir(findings).then(
          (all) => all.filter((name) => NUMBERED.test(name)).toSorted(),
          (cause: unknown) => {
            if (Predicate.hasProperty(cause, 'code') && cause.code === 'ENOENT') return []
            throw cause
          },
        ),
      )

      /** Every finding of these files; a file that does not read as one is left out, not lost. */
      const readAll = (files: ReadonlyArray<string>) =>
        Effect.forEach(files, (file) =>
          Effect.map(
            attempt(`reading ${file}`, () => readFile(join(findings, file), 'utf8')),
            (written) => {
              const finding = readFindingFile(written)
              return finding === null ? [] : [{ file, ...finding }]
            },
          ),
        ).pipe(Effect.map((read) => read.flat()))

      /** The highest number a finding took, as the folder keeps it; 0 before the first. */
      const lastNumber = attempt('reading the last number', () =>
        readFile(join(folder, LAST_NUMBER), 'utf8').then(
          (written) => Number.parseInt(written, 10) || 0,
          (cause: unknown) => {
            if (Predicate.hasProperty(cause, 'code') && cause.code === 'ENOENT') return 0
            throw cause
          },
        ),
      )

      /** The number the next finding takes: one past the highest a file or the folder names. */
      const nextNumber = (files: ReadonlyArray<string>, last: number) =>
        1 + Math.max(last, ...files.map((file) => Number(NUMBERED.exec(file)?.[1] ?? 0)))

      const mask = (value: string): string => secrets.mask(value)

      /** A report and its context as they are written: every text masked. */
      const masked = (reported: ReportedFinding, context: FindingContext) => ({
        reported: {
          ...reported,
          title: mask(reported.title),
          place: mask(reported.place),
          trying: mask(reported.trying),
          happened: mask(reported.happened),
          expected: mask(reported.expected),
          steps: mask(reported.steps),
          files: reported.files.map(mask),
          ...(reported.callId === undefined ? undefined : { callId: mask(reported.callId) }),
          ...(reported.error === undefined ? undefined : { error: mask(reported.error) }),
          ...(reported.code === undefined ? undefined : { code: mask(reported.code) }),
        },
        context: {
          ...context,
          where: mask(context.where),
          call:
            context.call === null
              ? null
              : {
                  ...context.call,
                  line: context.call.line === null ? null : mask(context.call.line),
                  arguments: context.call.arguments === null ? null : mask(context.call.arguments),
                },
        },
      })

      const report = (reported: ReportedFinding, context: FindingContext) =>
        Effect.gen(function* () {
          const clean = masked(reported, context)
          yield* attempt('making the findings folder', () => mkdir(findings, { recursive: true }))
          const files = yield* names
          const existing = yield* readAll(files)
          const found = matchingFinding(
            existing.map((one) => ({ ...one.head, one })),
            clean.reported,
          )
          // A new finding's number is read from every name and from the highest ever taken, so
          // a file that no longer reads, or that the user deleted, never has its number again.
          const number = nextNumber(files, yield* lastNumber)
          const final: FindingFile =
            found === null
              ? {
                  file: findingFileName(number, clean.reported.title),
                  ...newFinding(number, clean.reported, clean.context),
                }
              : {
                  file: found.one.file,
                  ...recordOccurrence(found.one, clean.reported, clean.context),
                }
          if (found === null) yield* replaced(join(folder, LAST_NUMBER), `${String(number)}\n`)
          yield* replaced(join(findings, final.file), writeFindingFile(final.head, final.body))
          const all = [...existing.filter((one) => one.file !== final.file), final]
          yield* replaced(
            join(folder, TESTER_INDEX),
            findingsIndex(all.map(({ head, file }) => ({ head, file }))),
          )
          const answer: ReportAnswer = {
            number: final.head.number,
            added: found !== null,
            occurrences: final.head.occurrences,
            file: final.file,
            title: final.head.title,
          }
          return answer
        }).pipe(Semaphore.withPermits(writing, 1))

      return {
        folder,
        hemera: {
          version: identity.version,
          channel: identity.channel,
          commit: commitOf(identity.version),
          os: identity.os,
        },
        report,
        list: names.pipe(
          Effect.flatMap(readAll),
          Effect.map((all) =>
            all.toSorted(
              (one, other) => instantOf(other.head.lastSeen) - instantOf(one.head.lastSeen),
            ),
          ),
        ),
      }
    }),
  )
