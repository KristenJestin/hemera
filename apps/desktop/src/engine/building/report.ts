/**
 * `prelaunch_report` (#139), as the gate executes it: the agent of a check answers every file it was
 * handed, once. Refused outside a `prelaunch` session, refused when a file of the brief is missing
 * or one is not of it, and accepted once per check; the files that matter mark the mission outdated
 * in the same transaction, and the check is done. Apart from the check's runs, so the gate imports
 * nothing that imports the sessions back.
 */

import { type ToolArguments, prelaunchReportRefusal } from '@hemera/core/domain'
import type { MovedItem } from '@hemera/ipc'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { markOutdatedIn } from '../planning/outdated.ts'
import { Secrets } from '../secrets.ts'
import { getSession } from '../sessions/store.ts'
import { refusedWhile } from '../storage/database.ts'
import { missions, prelaunchChecks } from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { mutate } from '../transaction.ts'
import { checkOfLineage, checkRowIn, resultsOf, writeResults } from './store.ts'
import { checkEvent } from './events.ts'

const now = (): string => new Date().toISOString()

export const prelaunchReportTool = (grant: Grant, args: ToolArguments<'prelaunch_report'>) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    const session = yield* getSession(grant.sessionId)
    const found = yield* checkOfLineage(session.lineage)
    if (found === null) return refusal('refused: this session checks no mission before its launch')
    return yield* mutate('keeping the pre-launch report', (transaction) =>
      Effect.gen(function* () {
        const no = (sentence: string) => ({ result: refusal(sentence), events: [] })
        const row = yield* checkRowIn(transaction, found.id)
        if (row === null || row.state !== 'running' || row.agentState !== 'running') {
          return no(
            row?.agentState === 'reported'
              ? 'refused: you reported already; end your turn'
              : `refused: this check already ended (${row?.state ?? 'gone'})`,
          )
        }
        const results = resultsOf(row)
        const items = args.items.map((item) => ({
          ...item,
          repository: item.repository.trim(),
          path: item.path.trim(),
        }))
        const wrong = prelaunchReportRefusal(results.handed, items)
        if (wrong !== null) return no(`refused: ${wrong}`)
        const answerOf = (repository: string, path: string) =>
          items.find((one) => one.repository === repository && one.path === path)
        const handed = results.handed.map((one) => {
          const item = answerOf(one.repository, one.path)
          return item === undefined
            ? one
            : { ...one, answer: { matters: item.matters, why: secrets.mask(item.why.trim()) } }
        })
        const matter = handed.filter((one) => one.answer?.matters === true)
        const moved: ReadonlyArray<MovedItem> = matter.map((one) => ({
          kind: 'agent',
          repository: one.repository,
          path: one.path,
          status: one.status,
          added: null,
          removed: null,
          said: `${one.repository}/${one.path} matters, the agent of the check says: ${one.answer?.why ?? ''}`,
        }))
        yield* transaction
          .update(prelaunchChecks)
          .set({
            state: 'done',
            agentState: 'reported',
            summary: secrets.mask(args.summary.trim()),
            endedAt: now(),
            results: writeResults({ ...results, handed, moved: [...results.moved, ...moved] }),
          })
          .where(and(eq(prelaunchChecks.id, row.id), eq(prelaunchChecks.state, 'running')))
          .pipe(Effect.mapError(refusedWhile('keeping the pre-launch report')))
        const [mission] = yield* transaction
          .select({ projectId: missions.projectId })
          .from(missions)
          .where(eq(missions.id, row.missionId))
          .pipe(Effect.mapError(refusedWhile('reading the mission')))
        const marked = []
        for (const item of moved) {
          marked.push(
            ...(yield* markOutdatedIn(
              transaction,
              row.missionId,
              {
                reason: 'target-moved',
                reference: `${item.repository ?? ''}/${item.path ?? ''}`,
                difference: item.said,
                expiring: [],
              },
              secrets.mask,
            )),
          )
        }
        const projectId = mission?.projectId ?? ''
        return {
          result: answered(
            `Kept: ${String(items.length)} file(s), ${String(matter.length)} matter. The check is done: end your turn.`,
          ),
          events: [
            checkEvent('building.check_result', row, projectId, {
              agent: 'reported',
              matters: matter.map((one) => `${one.repository}/${one.path}`),
              summary: secrets.mask(args.summary.trim()),
              sessionId: grant.sessionId,
              role: grant.role,
            }),
            checkEvent('building.check_ended', row, projectId, { lineage: row.lineage }),
            ...marked,
          ],
        }
      }),
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))
