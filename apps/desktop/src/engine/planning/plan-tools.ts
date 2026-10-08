/**
 * The Planner's three tools of #90, as the gate executes them once it let a call through:
 * `proof_write` (a scenario's Proof, whole or from a Probe's report), `tasks_write` (the whole task
 * graph) and `model_recommend` (the setting Building runs on, with its reason).
 *
 * Every write goes through #85's one rule (the Planner of a mission in Planning, its Spec not
 * frozen), bumps the Spec's version with its change row, writes its domain event in the same
 * transaction, and rewrites the readable file. The mission is always the one the session's token
 * works for. What Git says is read before the transaction, never inside it.
 */

import {
  type ModelRecommendation,
  type Proof,
  type SupportFile,
  type ToolArguments,
  graphProblemSaid,
  maskedJson,
  probeLabel,
  probeNumberOf,
  proofRefusals,
  proofSeen,
  proofText,
  recommendationText,
  staleSaid,
  taskGraph,
  taskText,
} from '@hemera/core/domain'
import type { SpecTask } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { join } from 'node:path'

import { Effect, Option, type Types } from 'effect'

import { Git } from '../git.ts'
import type { NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import {
  memoryEvidence,
  missionRecommendations,
  probes,
  specProofs,
  specTasks,
  specs,
} from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { type ToolAnswer, answered, failure, refusal } from '../tools/files.ts'
import { mutate } from '../transaction.ts'
import { AgentOffers } from './offers.ts'
import {
  type Place,
  basesAt,
  insertionProblems,
  liveIn,
  placeOf,
  planRows,
  readProof,
  recommendationOf,
  targetProblem,
  taskOf,
  writeStrings,
  writeTargets,
} from './plan.ts'
import { basesOf, readProbe, reportOf } from './probe-store.ts'
import { type SpecWriter, afterWrite, bump, standingOf } from './store.ts'

const now = (): string => new Date().toISOString()

/** The writer a grant stands for, when its session works for a mission. */
const writerOf = (grant: Grant): SpecWriter | null =>
  grant.missionId === null
    ? null
    : { sessionId: grant.sessionId, role: grant.role, missionId: grant.missionId }

const NO_MISSION = refusal('refused: this session works for no mission')

const refusedSaid = (sentence: string): ToolAnswer =>
  refusal(sentence.startsWith('refused:') ? sentence : `refused: ${sentence}`)

/** Every problem found, each on its line, and that nothing was written. */
const problemsSaid = (problems: ReadonlyArray<string>): ToolAnswer =>
  refusal(['refused: nothing was written:', ...problems.map((one) => `- ${one}`)].join('\n'))

/** Ids said as a list: `T1`, `T1 and T2`, `T1, T2 and T3`. */
const listSaid = (ids: ReadonlyArray<string>): string =>
  ids.length <= 1 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids.at(-1) ?? ''}`

/** One of the Planner's events about its mission. */
const plannerEvent = (
  writer: SpecWriter,
  type: string,
  payload: NonNullable<NewEvent['payload']>,
): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: writer.missionId,
  source: 'system',
  author: 'agent',
  payload: { ...payload, sessionId: writer.sessionId, role: writer.role },
})

/** A write's outcome inside its transaction: refused with the sentence the agent reads, or done. */
type Outcome<A> = { readonly refused: string } | { readonly done: A }

/** The sentence a write is refused with, as the transaction answers it. */
/** What a write's transaction answers: its outcome, and the events it records. */
interface Answered<A> {
  readonly result: Outcome<A>
  readonly events: ReadonlyArray<NewEvent>
}

const refusedWith = <A>(sentence: string): Answered<A> => ({
  result: { refused: sentence },
  events: [],
})

/** The evidence of a mission no name or id of `named` designates. */
const unknownEvidence = (missionId: string, named: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (named.length === 0) return []
    const database = yield* Database
    const kept = yield* database
      .select({ id: memoryEvidence.id, name: memoryEvidence.name })
      .from(memoryEvidence)
      .where(eq(memoryEvidence.missionId, missionId))
      .pipe(Effect.mapError(refusedWhile('reading the evidence')))
    return named.filter((one) => !kept.some((row) => row.id === one || row.name === one))
  })

type ProbeFound =
  | { readonly refused: string }
  | { readonly row: typeof probes.$inferSelect; readonly label: string }

const notFound = (refused: string): ProbeFound => ({ refused })

/** A mission's Probe by the `#n` an agent names, or why there is none. */
const probeNamed = (missionId: string, key: string, named: string) =>
  Effect.gen(function* () {
    const number = probeNumberOf(named)
    if (number === null) {
      return notFound(`${named} names no Probe: name one as probe_launch answered it (\`#2\`).`)
    }
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(probes)
      .where(and(eq(probes.missionId, missionId), eq(probes.number, number)))
      .pipe(Effect.mapError(refusedWhile('reading a Probe')))
    if (row === undefined) return notFound(`${key} has no Probe ${probeLabel(number)}.`)
    const found: ProbeFound = { row, label: probeLabel(number) }
    return found
  })

type FromProbe =
  | { readonly refused: string }
  | { readonly proof: Proof; readonly label: string; readonly left: ReadonlyArray<string> }

const notMade = (refused: string): FromProbe => ({ refused })

const lostSaid = (label: string, file: { readonly repository: string; readonly path: string }) =>
  `Probe ${label} kept no content of ${file.repository}/${file.path}: write the proof whole with \`proof\` and \`from_probe\`.`

/**
 * The proof a Probe's report makes (CT-31): its actions, starting data, command, expected, output
 * and key line, its test with its insertion form, and every file it captured whose content was
 * kept as a support file: a new file whole, a modified one as its patch against the Probe's base.
 * A file kept by path and hash only (a sensitive place, a binary, a link) is left out, and said.
 */
const proofFromProbe = (
  missionId: string,
  key: string,
  named: string,
  added: ReadonlyArray<SupportFile>,
) =>
  Effect.gen(function* () {
    const found = yield* probeNamed(missionId, key, named)
    if ('refused' in found) return notMade(found.refused)
    const { row, label } = found
    const report = reportOf(row)
    if (report === null) {
      return notMade(
        row.state === 'failed'
          ? `Probe ${label} failed: it left no report.`
          : `Probe ${label} has not reported yet: write the proof once its report arrives.`,
      )
    }
    const bases = new Map(basesOf(row).map((base) => [base.repository, base.commit]))
    const { files } = yield* readProbe(row.id)
    const isTest = (file: { readonly repository: string; readonly path: string }) =>
      report.test !== undefined &&
      file.repository === report.test.repository &&
      file.path === report.test.path
    const left: string[] = []
    const supportFiles: SupportFile[] = []
    for (const file of files) {
      if (isTest(file)) continue
      if (file.withheld !== null) {
        left.push(`${file.repository}/${file.path} (${file.withheld})`)
        continue
      }
      const kept: Types.Mutable<SupportFile> = {
        repository: file.repository,
        path: file.path,
        insertion: file.status === 'new' ? 'new_file' : 'addition',
        from_probe: label,
      }
      // What the capture should hold and does not is refused, never guessed as empty.
      const text = file.status === 'new' ? file.content : file.patch
      if (text === null) return notMade(lostSaid(label, file))
      if (file.status === 'new') kept.content = text
      else {
        kept.patch = text
        const against = bases.get(file.repository)
        if (against !== undefined) kept.against = against
      }
      supportFiles.push(kept)
    }
    const proof: Types.Mutable<Proof> = {
      mode: 'automated',
      actions: report.actions,
      starting_data: report.starting_data,
      expected: report.expected,
      support_files: [...supportFiles, ...added],
      seen_today: report.outcome === 'reproduced',
      base_commit: basesOf(row).map((base) => ({
        repository: base.repository,
        commit: base.commit,
      })),
      from_probe: label,
      evidence: report.evidence,
    }
    if (report.test !== undefined) {
      if (report.command === undefined) {
        return notMade(
          `The report of Probe ${label} gives its test but no command to run it: write the proof whole with \`proof\` and \`from_probe\`.`,
        )
      }
      const captured = files.find(isTest)
      const test: Types.Mutable<NonNullable<Proof['test']>> = {
        repository: report.test.repository,
        path: report.test.path,
        code: report.test.code,
        insertion: captured?.status === 'modified' ? 'addition' : 'new_file',
        command: report.command,
      }
      if (captured?.status === 'modified') {
        if (captured.patch === null) return notMade(lostSaid(label, captured))
        test.patch = captured.patch
        const against = bases.get(report.test.repository)
        if (against !== undefined) test.against = against
      }
      proof.test = test
    } else if (report.command !== undefined) proof.command = report.command
    if (report.observed !== undefined) proof.observed = report.observed
    if (report.key_line !== undefined) proof.key_line = report.key_line
    const made: FromProbe = { proof, label, left }
    return made
  })

/** Each commit a proof says it was seen on that its repository does not have. */
const unknownCommits = (place: Place, proof: Proof) =>
  Effect.gen(function* () {
    const git = yield* Git
    const problems: string[] = []
    for (const [at, seen] of (proof.base_commit ?? []).entries()) {
      const field = `\`base_commit[${String(at)}]\``
      const row = place.repositories.get(seen.repository)
      if (row === undefined) {
        problems.push(`${field}: the Project has no repository ${seen.repository}.`)
        continue
      }
      const found = yield* git
        .commitOf(join(place.main, row.path), seen.commit)
        .pipe(Effect.orElseSucceed(() => Option.none<string>()))
      if (Option.isNone(found)) {
        problems.push(`${field}: ${seen.commit} is no commit of ${seen.repository}.`)
      }
    }
    return problems
  })

/** The texts of a proof masking may change, by the field a refusal names and what it is. */
const maskableOf = (proof: Proof): ReadonlyArray<readonly [string, string, string | undefined]> => [
  ['observed', 'text', proof.observed],
  ['key_line', 'text', proof.key_line],
  ['test', 'code', proof.test?.code],
  ['test', 'patch', proof.test?.patch],
  ...(proof.support_files ?? []).flatMap((file, at) => [
    [`support_files[${String(at)}]`, 'content', file.content] as const,
    [`support_files[${String(at)}]`, 'patch', file.patch] as const,
  ]),
]

/** Where masking changed what the Planner gave: a refusal says its checks ran on the masked text. */
const maskingSaid = (given: Proof, masked: Proof): ReadonlyArray<string> => {
  const after = maskableOf(masked)
  return maskableOf(given).flatMap(([field, what, text], at) =>
    text === after[at]?.[2]
      ? []
      : [
          `\`${field}\`: Hemera masked a secret in its ${what} before checking it: the check ran on the text it keeps.`,
        ],
  )
}

/** What a proof write answers once it committed, or that nothing changed. */
interface ProofWritten {
  readonly version: number
  readonly spec: number
  readonly changed: boolean
}

/**
 * `proof_write`: a scenario's Proof, whole or from a Probe, on the version of the proof the
 * Planner read. Refused, every problem named and nothing written, when the proof lacks what it
 * needs or a file it inserts would not go in at the base commit.
 */
export const proofWrite = (grant: Grant, args: ToolArguments<'proof_write'>) =>
  Effect.gen(function* () {
    const writer = writerOf(grant)
    if (writer === null) return NO_MISSION
    const secrets = yield* Secrets
    const place = yield* placeOf(writer.missionId)
    let proof: Proof
    let fromProbe: string | null = null
    let left: ReadonlyArray<string> = []
    if (args.probe !== undefined) {
      const made = yield* proofFromProbe(
        writer.missionId,
        place.key,
        args.probe,
        args.support_files ?? [],
      )
      if ('refused' in made) return refusedSaid(made.refused)
      proof = made.proof
      fromProbe = made.label
      left = made.left
    } else if (args.proof !== undefined) {
      proof = args.proof
      if (proof.from_probe !== undefined) {
        const found = yield* probeNamed(writer.missionId, place.key, proof.from_probe)
        if ('refused' in found) return refusedSaid(found.refused)
        fromProbe = found.label
      }
    } else return refusal('refused: give the proof, or the Probe whose report becomes it')
    // What was seen is kept trimmed, as the report quotes it.
    if (proof.observed !== undefined) proof = { ...proof, observed: proof.observed.trim() }
    if (proof.key_line !== undefined) proof = { ...proof, key_line: proof.key_line.trim() }
    // Checked as it is kept: masked (#35), so what passes is what Building will read.
    const block = maskedJson(secrets.maskRecord(proof))
    const masked = Option.getOrElse(readProof(block), () => proof)
    const problems = [...proofRefusals(masked)]
    for (const name of yield* unknownEvidence(writer.missionId, masked.evidence ?? [])) {
      problems.push(
        `\`evidence\`: ${name} is no evidence of ${place.key}: keep it with evidence_add.`,
      )
    }
    if (problems.length === 0) {
      problems.push(
        ...(yield* insertionProblems(place, masked, false)),
        ...(yield* unknownCommits(place, masked)),
      )
    }
    if (problems.length > 0) return problemsSaid([...problems, ...maskingSaid(proof, masked)])
    const scenario = args.scenario
    const outcome = yield* mutate('writing a proof of the Spec', (transaction) =>
      Effect.gen(function* () {
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return refusedWith<ProofWritten>(standing.refusal)
        const live = yield* liveIn(transaction, writer.missionId)
        if (!live.scenarios.includes(scenario)) {
          return refusedWith<ProofWritten>(
            `refused: ${scenario} is not a live scenario of the Spec: name one as spec_read gives it.`,
          )
        }
        const [row] = yield* transaction
          .select()
          .from(specProofs)
          .where(
            and(eq(specProofs.missionId, writer.missionId), eq(specProofs.scenarioId, scenario)),
          )
          .pipe(Effect.mapError(refusedWhile('reading the proofs')))
        const current = row?.version ?? 0
        const before = row === undefined ? null : Option.getOrNull(readProof(row.block))
        const beforeText = before === null ? '' : proofText(proofSeen(before))
        if (args.base_version !== current) {
          return refusedWith<ProofWritten>(
            staleSaid(`the proof of ${scenario}`, args.base_version, current, beforeText),
          )
        }
        if (row?.block === block) {
          const same: Outcome<ProofWritten> = {
            done: { version: current, spec: standing.spec.version, changed: false },
          }
          return { result: same, events: [] }
        }
        const version = current + 1
        const line = { version, block, fromProbe, sessionId: writer.sessionId, writtenAt: now() }
        yield* transaction
          .insert(specProofs)
          .values({ missionId: writer.missionId, scenarioId: scenario, ...line })
          .onConflictDoUpdate({ target: [specProofs.missionId, specProofs.scenarioId], set: line })
          .pipe(Effect.mapError(refusedWhile('writing a proof')))
        const spec = standing.spec.version + 1
        yield* bump(transaction, writer, spec, [
          {
            item: `${scenario} proof`,
            before: before === null ? null : beforeText,
            after: proofText(proofSeen(masked)),
          },
        ])
        const done: Outcome<ProofWritten> = { done: { version, spec, changed: true } }
        return {
          result: done,
          events: [
            plannerEvent(writer, 'planning.proof_written', { scenario, fromProbe, version }),
          ],
        }
      }),
    )
    if ('refused' in outcome) return refusedSaid(outcome.refused)
    const { version, spec, changed } = outcome.done
    if (!changed) {
      return answered(
        `${scenario}’s proof already reads so: nothing changed (version ${String(version)}).`,
      )
    }
    yield* afterWrite(writer, [{ kind: 'proof', id: scenario }])
    return answered(
      [
        `Written: ${scenario}’s proof is at version ${String(version)}${fromProbe === null ? '' : `, from Probe ${fromProbe}`}; the Spec at version ${String(spec)}.`,
        left.length === 0 ? null : `Left out: ${left.join(', ')}.`,
      ]
        .filter((part) => part !== null)
        .join(' '),
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))

/** A task of a write, its id given: kept from the graph, or the next of the mission. */
interface Resolved {
  readonly id: string
  readonly number: number
  readonly kept: boolean
  readonly asked: ToolArguments<'tasks_write'>['tasks'][number]
}

/** Where a task's id goes in what Git said of its targets, before the id is given. */
const TASK = '\u0000task\u0000'

/** What a graph write answers once it committed. */
interface TasksWritten {
  readonly ids: ReadonlyArray<string>
  readonly added: ReadonlyArray<string>
  readonly changed: ReadonlyArray<string>
  readonly removed: ReadonlyArray<string>
  readonly spec: number
}

const changesSaid = (written: Pick<TasksWritten, 'added' | 'changed' | 'removed'>): string =>
  [
    written.added.length === 0 ? null : `added ${written.added.join(', ')}`,
    written.changed.length === 0 ? null : `changed ${written.changed.join(', ')}`,
    written.removed.length === 0 ? null : `removed ${written.removed.join(', ')}`,
  ]
    .filter((part) => part !== null)
    .join('; ')

const tasksCounted = (count: number): string => `${String(count)} task${count === 1 ? '' : 's'}`

/**
 * `tasks_write`: the whole task graph. Each task keeps its id; a new one takes the next of the
 * mission; one left out is removed and its id never reused. Refused, every problem named and
 * nothing written, on a cycle, a reference to nothing, or a target that is not as its intent says
 * at the base commit (CT-30).
 */
export const tasksWrite = (grant: Grant, args: ToolArguments<'tasks_write'>) =>
  Effect.gen(function* () {
    const writer = writerOf(grant)
    if (writer === null) return NO_MISSION
    const secrets = yield* Secrets
    const place = yield* placeOf(writer.missionId)
    const { bases, problems: unread } = yield* basesAt(
      place,
      new Set(args.tasks.flatMap((task) => task.targets.map((target) => target.repository))),
      false,
    )
    // What Git says of each target, by the task's place in the write: its id is given inside.
    const targetSaid = new Map<string, string>()
    for (const [at, task] of args.tasks.entries()) {
      for (const [index, target] of task.targets.entries()) {
        const problem = yield* targetProblem(place, bases, TASK, target)
        if (problem !== null) targetSaid.set(`${String(at)}:${String(index)}`, problem)
      }
    }
    const outcome = yield* mutate('writing the task graph', (transaction) =>
      Effect.gen(function* () {
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return refusedWith<TasksWritten>(standing.refusal)
        const rows = yield* transaction
          .select()
          .from(specTasks)
          .where(eq(specTasks.missionId, writer.missionId))
          .pipe(Effect.mapError(refusedWhile('reading the tasks')))
        const live = rows.filter((row) => !row.removed)
        const graphText = (tasks: ReadonlyArray<SpecTask>) =>
          tasks.length === 0 ? null : tasks.map(taskText).join('\n')
        const current = standing.spec.tasksVersion
        if (args.base_version !== current) {
          return refusedWith<TasksWritten>(
            staleSaid(
              'the task graph',
              args.base_version,
              current,
              graphText(live.toSorted((a, b) => a.rank - b.rank).map(taskOf)) ?? '',
            ),
          )
        }
        let next = Math.max(0, ...rows.map((row) => row.number)) + 1
        const problems: string[] = [...unread]
        const resolved: Resolved[] = args.tasks.map((asked) => {
          const kept = asked.id === undefined ? undefined : live.find((row) => row.id === asked.id)
          if (asked.id !== undefined && kept === undefined) {
            problems.push(
              `${asked.id} is not a task of the graph: leave the id out for a new task; ids are never reused.`,
            )
          }
          const number = kept?.number ?? next
          if (kept === undefined) next += 1
          return { id: kept?.id ?? `T${String(number)}`, number, kept: kept !== undefined, asked }
        })
        // A dependency names a task of this write by its id, or a new one by its title.
        const dependsOn = (task: Resolved): ReadonlyArray<string> =>
          task.asked.depends_on.map((named) => {
            const byId = resolved.find((one) => one.id === named)
            if (byId !== undefined) return byId.id
            // A title two new tasks share is refused below; the first stands for it meanwhile.
            const byTitle = resolved.find((one) => !one.kept && one.asked.title === named)
            return byTitle?.id ?? named
          })
        for (const task of resolved) {
          for (const named of task.asked.depends_on) {
            if (resolved.some((one) => one.id === named)) continue
            const sharing = resolved.filter((one) => !one.kept && one.asked.title === named)
            if (sharing.length > 1) {
              problems.push(
                `${task.id} depends on "${named}", the title of more than one new task: give each its own title, or name the task by its id.`,
              )
            }
          }
        }
        const coverable = yield* liveIn(transaction, writer.missionId)
        problems.push(
          ...taskGraph(
            resolved.map((task) => ({
              id: task.id,
              title: task.asked.title,
              requirements: task.asked.requirements,
              scenarios: task.asked.scenarios,
              dependsOn: dependsOn(task),
            })),
            {
              requirements: new Set(coverable.requirements),
              scenarios: new Set(coverable.scenarios),
            },
          ).map(graphProblemSaid),
        )
        for (const [at, task] of resolved.entries()) {
          for (const index of task.asked.targets.keys()) {
            const said = targetSaid.get(`${String(at)}:${String(index)}`)
            if (said !== undefined) problems.push(said.replaceAll(TASK, task.id))
          }
        }
        if (problems.length > 0) return refusedWith<TasksWritten>(problems.join('\n'))
        const at = now()
        const added: string[] = []
        const changed: string[] = []
        for (const [rank, task] of resolved.entries()) {
          const fields = {
            rank,
            title: secrets.mask(task.asked.title.trim()),
            result: secrets.mask(task.asked.result.trim()),
            requirements: writeStrings(task.asked.requirements),
            scenarios: writeStrings(task.asked.scenarios),
            targets: secrets.mask(writeTargets(task.asked.targets)),
            dependsOn: writeStrings(dependsOn(task)),
          }
          const before = live.find((row) => row.id === task.id)
          if (before === undefined) {
            added.push(task.id)
            yield* transaction
              .insert(specTasks)
              .values({
                missionId: writer.missionId,
                id: task.id,
                number: task.number,
                ...fields,
                removed: false,
                sessionId: writer.sessionId,
                writtenAt: at,
              })
              .pipe(Effect.mapError(refusedWhile('writing a task')))
            continue
          }
          const same =
            before.rank === fields.rank &&
            before.title === fields.title &&
            before.result === fields.result &&
            before.requirements === fields.requirements &&
            before.scenarios === fields.scenarios &&
            before.targets === fields.targets &&
            before.dependsOn === fields.dependsOn
          if (same) continue
          changed.push(task.id)
          yield* transaction
            .update(specTasks)
            .set({ ...fields, sessionId: writer.sessionId, writtenAt: at })
            .where(and(eq(specTasks.missionId, writer.missionId), eq(specTasks.id, task.id)))
            .pipe(Effect.mapError(refusedWhile('writing a task')))
        }
        const removed = live
          .filter((row) => !resolved.some((task) => task.id === row.id))
          .map((row) => row.id)
        for (const id of removed) {
          yield* transaction
            .update(specTasks)
            .set({ removed: true, sessionId: writer.sessionId, writtenAt: at })
            .where(and(eq(specTasks.missionId, writer.missionId), eq(specTasks.id, id)))
            .pipe(Effect.mapError(refusedWhile('removing a task')))
        }
        const ids = resolved.map((task) => task.id)
        if (added.length === 0 && changed.length === 0 && removed.length === 0) {
          const same: Outcome<TasksWritten> = {
            done: { ids, added, changed, removed, spec: standing.spec.version },
          }
          return { result: same, events: [] }
        }
        const after = yield* planRows(transaction, writer.missionId)
        const spec = standing.spec.version + 1
        yield* bump(transaction, writer, spec, [
          { item: 'tasks', before: graphText(live.map(taskOf)), after: graphText(after.tasks) },
        ])
        yield* transaction
          .update(specs)
          .set({ tasksVersion: current + 1 })
          .where(eq(specs.missionId, writer.missionId))
          .pipe(Effect.mapError(refusedWhile('writing the task graph')))
        const done: Outcome<TasksWritten> = { done: { ids, added, changed, removed, spec } }
        return {
          result: done,
          events: [
            plannerEvent(writer, 'planning.tasks_written', {
              count: ids.length,
              added,
              changed,
              removed,
            }),
          ],
        }
      }),
    )
    if ('refused' in outcome) {
      return outcome.refused.startsWith('refused:')
        ? refusal(outcome.refused)
        : problemsSaid(outcome.refused.split('\n'))
    }
    const written = outcome.done
    const what = changesSaid(written)
    if (what === '') return answered('The task graph already reads so: nothing changed.')
    yield* afterWrite(writer, [{ kind: 'tasks' }])
    return answered(
      `Written: ${tasksCounted(written.ids.length)}, ${listSaid(written.ids)} (${what}).`,
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))

/** A recommendation as its answer and its Journal line say it. */
const recommendedSaid = (recommendation: Pick<ModelRecommendation, 'agent' | 'model' | 'effort'>) =>
  recommendationText({ ...recommendation, reason: '' }).replace(/: $/, '')

/**
 * `model_recommend`: the Planner's recommended setting for Building, with its reason. Refused when
 * the agent does not offer that model or that effort, as the Planner's own live session lists
 * them; another agent is checked as able to run here, and kept unchecked.
 */
export const modelRecommend = (grant: Grant, args: ToolArguments<'model_recommend'>) =>
  Effect.gen(function* () {
    const writer = writerOf(grant)
    if (writer === null) return NO_MISSION
    const secrets = yield* Secrets
    const { agent, model } = args
    const effort = args.effort ?? null
    const offer = yield* AgentOffers.use((offers) => offers.of(grant.sessionId, agent))
    if (offer.kind === 'unusable')
      return refusal(`refused: ${agent} cannot run here: ${offer.reason}`)
    // An agent that lists no model gives nothing to check against: kept unchecked, as another's.
    const listed = offer.kind === 'offered' && offer.models.length > 0
    if (offer.kind === 'offered' && listed) {
      if (!offer.models.includes(model)) {
        return refusal(
          `refused: ${agent} does not offer the model ${model}: it offers ${offer.models.join(', ')}.`,
        )
      }
      if (effort !== null && !offer.efforts.includes(effort)) {
        return refusal(
          offer.efforts.length === 0
            ? `refused: ${agent} offers no choice of effort with ${model}: leave it out.`
            : `refused: ${agent} does not offer the effort ${effort} with ${model}: it offers ${offer.efforts.join(', ')}.`,
        )
      }
    }
    const checked = listed
    const reason = secrets.mask(args.reason.trim())
    const said = recommendedSaid({ agent, model, effort })
    const outcome = yield* mutate('recommending a model for Building', (transaction) =>
      Effect.gen(function* () {
        const standing = yield* standingOf(transaction, writer)
        if (standing.refusal !== null) return refusedWith<boolean>(standing.refusal)
        const [before] = yield* transaction
          .select()
          .from(missionRecommendations)
          .where(eq(missionRecommendations.missionId, writer.missionId))
          .pipe(Effect.mapError(refusedWhile('reading the recommended model')))
        if (
          before !== undefined &&
          before.agent === agent &&
          before.model === model &&
          before.effort === effort &&
          before.reason === reason &&
          before.checked === checked
        ) {
          const same: Outcome<boolean> = { done: false }
          return { result: same, events: [] }
        }
        const line = {
          agent,
          model,
          effort,
          reason,
          checked,
          sessionId: writer.sessionId,
          at: now(),
        }
        yield* transaction
          .insert(missionRecommendations)
          .values({ missionId: writer.missionId, ...line })
          .onConflictDoUpdate({ target: missionRecommendations.missionId, set: line })
          .pipe(Effect.mapError(refusedWhile('recommending a model')))
        yield* bump(transaction, writer, standing.spec.version + 1, [
          {
            item: 'model',
            before:
              before === undefined
                ? null
                : `${recommendedSaid({ agent: recommendationOf(before).agent, model: before.model, effort: before.effort })}: ${before.reason}`,
            after: `${said}: ${reason}`,
          },
        ])
        const done: Outcome<boolean> = { done: true }
        return {
          result: done,
          events: [
            plannerEvent(writer, 'planning.model_recommended', {
              agent,
              model,
              effort,
              reason,
              checked,
            }),
          ],
        }
      }),
    )
    if ('refused' in outcome) return refusedSaid(outcome.refused)
    if (outcome.done) yield* afterWrite(writer, [{ kind: 'model' }])
    return answered(
      [
        `Kept: Building is recommended to run on ${said}.`,
        checked
          ? null
          : offer.kind === 'offered'
            ? `${agent} lists no model here to check it against: the pre-launch check checks it.`
            : `No ${agent} session runs to list its models: the pre-launch check checks it.`,
        'The user sees it before Building starts and may change it.',
      ]
        .filter((part) => part !== null)
        .join(' '),
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))
