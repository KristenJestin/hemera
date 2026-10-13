/**
 * The evidence of a Building as the reviewers read it (#147): the final checks with their verdict,
 * each scenario's proof runs (red and green, classified, up to date or not), the manual scenarios,
 * the documenter's report, the files changed outside their task's targets, and those written
 * before the red. Composed by Hemera from what the Building keeps, never from the Builder's
 * reasoning: the reviewers' brief names it, and `evidence_read` hands it in full.
 */

import type { BuildingView, ProofsView } from '@hemera/ipc'
import { Effect } from 'effect'

import type { Database, EngineTransaction } from '../storage/database.ts'
import { proofsViewIn } from './proof-store.ts'
import { type BuildingRow, viewIn } from './tasks.ts'

type Reader = EngineTransaction | Database['Service']

/** What the evidence is read from: the Building as its page reads it, and its proofs. */
export interface Evidence {
  readonly view: BuildingView
  readonly proofs: ProofsView
}

export const evidenceIn = (reader: Reader, building: BuildingRow) =>
  Effect.gen(function* () {
    const evidence: Evidence = {
      view: yield* viewIn(reader, building),
      proofs: yield* proofsViewIn(reader, building.missionId, building.id),
    }
    return evidence
  })

const where = (place: string): string => (place === '' ? 'the Workspace root' : place)

/** The final checks: the last result of each, its place, its verdict and whether it is current. */
export const finalChecksSaid = (evidence: Evidence, output = false): ReadonlyArray<string> => {
  const fresh = evidence.proofs.finalChecks
  return evidence.view.scopes
    .filter((one) => one.scope === 'end' && one.subject === null)
    .flatMap((one) => one.checks)
    .filter(
      (check, at, all) =>
        all.findLastIndex((other) => other.name === check.name && other.place === check.place) ===
        at,
    )
    .map((check) => {
      const current = fresh.find((one) => one.name === check.name && one.place === check.place)
      const line = `- ${check.name} · ${where(check.place)}: ${check.verdict}${current === undefined ? '' : current.upToDate ? ', up to date' : ', stale'}`
      return output && check.outputTail.trim() !== ''
        ? `${line}\n  ${check.outputTail.trim().split('\n').join('\n  ')}`
        : line
    })
}

/** Each automated scenario: its red's classification, its green, and whether it is up to date. */
export const proofRunsSaid = (evidence: Evidence, scenario?: string): ReadonlyArray<string> =>
  evidence.proofs.scenarios
    .filter(
      (one) => one.mode === 'automated' && (scenario === undefined || one.scenario === scenario),
    )
    .map((one) => {
      const red = one.red === null ? 'no red' : `red ${one.red.classification.replaceAll('_', ' ')}`
      const green =
        one.green === null ? 'no green' : `green ${one.green.classification.replaceAll('_', ' ')}`
      const fresh = one.upToDate === null ? '' : one.upToDate ? ', up to date' : ', stale'
      const runs =
        scenario === undefined
          ? ''
          : one.runs
              .map(
                (run) =>
                  `\n  ${run.phase} at ${run.at}: ${run.classification.replaceAll('_', ' ')}, exit ${String(run.exitCode ?? 'none')}${run.outputTail.trim() === '' ? '' : `\n    ${run.outputTail.trim().split('\n').join('\n    ')}`}`,
              )
              .join('')
      return `- ${one.scenario}: ${red}; ${green}${fresh} (${one.state.replaceAll('_', ' ')})${runs}`
    })

/** The scenarios verified by hand, and where each stands. */
export const manualSaid = (evidence: Evidence): ReadonlyArray<string> =>
  evidence.proofs.scenarios
    .filter((one) => one.mode === 'by_hand')
    .map(
      (one) =>
        `- ${one.scenario}: ${one.state.replaceAll('_', ' ')}${one.manual?.note == null ? '' : ` (${one.manual.note})`}`,
    )

/** What the documenter reported, pass by pass. */
export const documentationSaid = (evidence: Evidence): ReadonlyArray<string> =>
  evidence.view.documenter.map((pass) => {
    const said =
      pass.state === 'failed'
        ? `failed: ${pass.failure ?? ''}`
        : pass.noChangeReason !== null
          ? `no change: ${pass.noChangeReason}`
          : pass.changed.length > 0
            ? pass.changed.map((one) => `${one.repository}/${one.path} (${one.why})`).join('; ')
            : pass.state.replaceAll('_', ' ')
    return `- Pass ${String(pass.number)} (${pass.mode}): ${said}`
  })

/** The files each task changed outside its targets (CT-42). */
export const outsideSaid = (evidence: Evidence): ReadonlyArray<string> =>
  evidence.view.tasks.flatMap((task) =>
    [...new Set(task.attempts.flatMap((attempt) => attempt.outside))].map(
      (path) => `- ${task.id}: ${path}`,
    ),
  )

/** The writes made before a red, and the proof tests changed after theirs (#144). */
export const beforeRedSaid = (evidence: Evidence): ReadonlyArray<string> => [
  ...evidence.proofs.writtenBeforeRed.map(
    (one) =>
      `- written before the red of ${one.scenarios.join(', ')}: ${one.repository}/${one.path}${one.task === null ? '' : ` (${one.task})`}`,
  ),
  ...evidence.proofs.scenarios
    .filter((one) => one.testChanged)
    .map(
      (one) =>
        `- the proof test of ${one.scenario} changed after its red: ${one.green?.testPath ?? one.red?.testPath ?? ''}`,
    ),
]

const listed = (lines: ReadonlyArray<string>): string | null =>
  lines.length === 0 ? null : lines.join('\n')

/** The whole evidence, or one scenario's runs, or one final check's result with its output. */
export const evidenceSaid = (
  evidence: Evidence,
  asked: { readonly scenario?: string | undefined; readonly check?: string | undefined },
): string => {
  if (asked.scenario !== undefined) {
    const runs = proofRunsSaid(evidence, asked.scenario)
    return runs.length === 0
      ? `${asked.scenario} has no automated proof in this Building.`
      : `## Proof runs of ${asked.scenario}\n\n${runs.join('\n')}`
  }
  if (asked.check !== undefined) {
    const named = asked.check.trim().toLowerCase()
    const checks = finalChecksSaid(evidence, true).filter((line) =>
      line.slice(2).toLowerCase().startsWith(named),
    )
    return checks.length === 0
      ? `No final check is named ${asked.check}.`
      : `## Final check ${asked.check}\n\n${checks.join('\n')}`
  }
  return [
    ['Final checks', listed(finalChecksSaid(evidence)) ?? 'None ran.'],
    ['Proof runs', listed(proofRunsSaid(evidence)) ?? 'No automated scenario.'],
    ['Manual scenarios', listed(manualSaid(evidence)) ?? 'None.'],
    ['Documentation', listed(documentationSaid(evidence)) ?? 'The documenter did not run.'],
    ['Changed outside its targets', listed(outsideSaid(evidence)) ?? 'None.'],
    ['Written before the red', listed(beforeRedSaid(evidence)) ?? 'None.'],
  ]
    .map(([label, text]) => `## ${label ?? ''}\n\n${text ?? ''}`)
    .join('\n\n')
}

export const listedOrNull = listed
