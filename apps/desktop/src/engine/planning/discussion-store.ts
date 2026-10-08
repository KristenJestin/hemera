/**
 * The Discuss conversations in the database (#87): read whole, with their messages, and written by
 * the Planner's side (a reply, a proposal). The user's side, which delivers to the Planner, is
 * `discussions.ts`; this file is what completeness, the ball and the Planner's brief read too.
 *
 * A discussion is `#1`, `#2`… per mission, on one item of the Spec: a section by its name, a
 * requirement (`R3`), a scenario (`R3.S1`), a decision of the Decisions section (`D2`), or a
 * question of #86 (`Q4`). Only the user opens and closes one; the Planner replies and proposes.
 */

import { SECTION_TITLES, SPEC_SECTIONS, type ToolArguments, missionKey } from '@hemera/core/domain'
import {
  type Discussion,
  DISCUSSION_ITEM_KINDS,
  type DiscussionItem,
  type Spec,
  UnknownDiscussion,
} from '@hemera/ipc'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { Effect } from 'effect'

import type { NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  agentSessions,
  discussionMessages,
  discussions,
  missions,
  sessionDeliveries,
} from '../storage/schema.ts'
import type { Grant } from '../tools/access.ts'
import { answered, failure, refusal } from '../tools/files.ts'
import { mutate } from '../transaction.ts'
import { discussionInputs } from './discussion-inputs.ts'
import { pendingIn } from './inputs.ts'

type DiscussionRow = typeof discussions.$inferSelect
type MessageRow = typeof discussionMessages.$inferSelect

export const labelOf = (number: number): string => `#${String(number)}`

/** An item as a sentence names it: a section by its title, the others by their id. */
export const itemSaid = (item: DiscussionItem): string => {
  const section = SPEC_SECTIONS.find((name) => item.kind === 'section' && name === item.id)
  return section === undefined ? item.id : SECTION_TITLES[section]
}

/** What a closed discussion refuses. */
export const closedSaid = (label: string): string =>
  `${label} is closed: nothing more is said in it.`

/** A refusal outside Planning, as the user and the Planner read it. */
export const notPlanningSaid = (key: string): string =>
  `${key} is not in Planning: a discussion is for a mission in Planning.`

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The item as it stands in the Spec, as the Planner is handed it; null when the Spec has no such
 * item. A question's text is #86's, handed in.
 */
export const itemContent = (
  spec: Spec,
  item: DiscussionItem,
  question: string | null,
): string | null => {
  const live = spec.requirements.filter((one) => !one.removed)
  const scenarioLine = (scenario: Spec['requirements'][number]['scenarios'][number]) =>
    `- ${scenario.id}: WHEN ${scenario.when} THEN ${scenario.then}`
  switch (item.kind) {
    case 'section': {
      const section = spec.sections.find((one) => one.name === item.id)
      if (section === undefined) return null
      return section.body.trim() === '' ? 'Not written yet.' : section.body.trim()
    }
    case 'requirement': {
      const requirement = live.find((one) => one.id === item.id)
      if (requirement === undefined) return null
      return [
        `${requirement.id} · ${requirement.delta} · ${requirement.domain}`,
        requirement.text,
        requirement.scenarios.map(scenarioLine).join('\n'),
      ]
        .filter((part) => part !== '')
        .join('\n\n')
    }
    case 'scenario': {
      for (const requirement of live) {
        const scenario = requirement.scenarios.find((one) => one.id === item.id)
        if (scenario !== undefined)
          return `Of ${requirement.id}: ${requirement.text}\n\n${scenarioLine(scenario)}`
      }
      return null
    }
    case 'decision': {
      const decisions = spec.sections.find((one) => one.name === 'decisions')?.body ?? ''
      return new RegExp(`(^|[^\\w])${escaped(item.id)}([^\\w]|$)`).test(decisions)
        ? decisions.trim()
        : null
    }
    case 'question':
      return question
  }
}

export const itemOf = (row: DiscussionRow): DiscussionItem => ({
  kind: DISCUSSION_ITEM_KINDS.find((one) => one === row.itemKind) ?? 'section',
  id: row.itemId,
})

/**
 * The Planner of a mission as a discussion's ball reads it: whether one lives, whether one is in a
 * turn (or starting), or why the last one failed.
 */
interface PlannerNow {
  readonly live: boolean
  readonly running: boolean
  /** The reason the last one failed, when none lives since. */
  readonly failed: string | null
}

const NO_PLANNER: PlannerNow = { live: false, running: false, failed: null }

/** The states of a Planner session that may still answer: a stuck one is replaced. */
const PLANNER_LIVES = ['starting', 'working', 'idle', 'stuck'] as const

/** The states of a Planner still starting or in a turn: it may still answer in that turn. */
const PLANNER_RUNS = ['starting', 'working', 'stuck'] as const

/**
 * Who an open discussion waits on: the user once the agent spoke last or proposed, or when the
 * Planner it waits on failed. The user's last message waits on the agent while no Planner lives
 * (the next one gets it), while a Planner is starting or in a turn, or while its delivery is still
 * queued for the live one; a Planner idle after taking it without a reply leaves it to the user.
 */
const waitsOnOf = (
  row: DiscussionRow,
  messages: ReadonlyArray<MessageRow>,
  planner: PlannerNow,
  queued: ReadonlySet<string>,
) => {
  if (row.state !== 'open') return null
  const last = messages.at(-1)
  if (row.proposal !== null || last?.author === 'agent') return 'user'
  if (planner.failed !== null) return 'user'
  if (!planner.live || planner.running) return 'agent'
  return last !== undefined && last.deliveryId !== null && queued.has(last.deliveryId)
    ? 'agent'
    : 'user'
}

const discussionOf = (
  row: DiscussionRow,
  messages: ReadonlyArray<MessageRow>,
  planner: PlannerNow,
  queued: ReadonlySet<string>,
): Discussion => ({
  id: row.id,
  missionId: row.missionId,
  number: row.number,
  label: labelOf(row.number),
  item: itemOf(row),
  state: row.state === 'closed' ? 'closed' : 'open',
  outcome: row.outcome === 'decision' || row.outcome === 'no_decision' ? row.outcome : null,
  decision: row.decision,
  proposal:
    row.proposal === null || row.proposedAt === null
      ? null
      : { text: row.proposal, at: row.proposedAt },
  closedBy: row.closedBy === 'user' ? 'user' : null,
  closedAt: row.closedAt,
  openedAt: row.openedAt,
  waitsOn: waitsOnOf(row, messages, planner, queued),
  plannerFailed:
    row.state === 'open' && messages.at(-1)?.author === 'user' && row.proposal === null
      ? planner.failed
      : null,
  messages: messages.map((message) => ({
    author: message.author === 'agent' ? 'agent' : 'user',
    text: message.text,
    proposal: message.proposal,
    at: message.at,
  })),
})

type Reader = EngineTransaction | Database['Service']

/** The Planner now of each of these missions, from its sessions: the latest first. */
const plannersNow = (reader: Reader, missionIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const rows = yield* reader
      .select({
        missionId: agentSessions.ownerId,
        state: agentSessions.state,
        reason: agentSessions.stateReason,
      })
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.ownerKind, 'mission'),
          inArray(agentSessions.ownerId, [...missionIds]),
          eq(agentSessions.role, 'planner'),
        ),
      )
      .orderBy(desc(agentSessions.createdAt))
      .pipe(Effect.mapError(refusedWhile('reading the Planners')))
    const planners = new Map<string, PlannerNow>()
    for (const missionId of new Set(missionIds)) {
      const own = rows.filter((row) => row.missionId === missionId)
      const live = own.some((row) => PLANNER_LIVES.some((state) => state === row.state))
      const [last] = own
      planners.set(missionId, {
        live,
        running: own.some((row) => PLANNER_RUNS.some((state) => state === row.state)),
        failed: !live && last?.state === 'failed' ? (last.reason ?? 'it failed') : null,
      })
    }
    return planners
  })

/** These discussions, read whole with their messages and the ball their Planner gives them. */
const withMessages = (reader: Reader, rows: ReadonlyArray<DiscussionRow>) =>
  Effect.gen(function* () {
    if (rows.length === 0) return []
    const planners = yield* plannersNow(
      reader,
      rows.map((row) => row.missionId),
    )
    const messages = yield* reader
      .select()
      .from(discussionMessages)
      .where(
        inArray(
          discussionMessages.discussionId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(discussionMessages.sequence))
      .pipe(Effect.mapError(refusedWhile('reading the discussions')))
    const carrying = [
      ...new Set(messages.flatMap((one) => (one.deliveryId === null ? [] : [one.deliveryId]))),
    ]
    const queued =
      carrying.length === 0
        ? []
        : yield* reader
            .select({ id: sessionDeliveries.id })
            .from(sessionDeliveries)
            .where(
              and(inArray(sessionDeliveries.id, carrying), eq(sessionDeliveries.state, 'queued')),
            )
            .pipe(Effect.mapError(refusedWhile('reading the discussions’ deliveries')))
    const waiting = new Set(queued.map((one) => one.id))
    return rows.map((row) =>
      discussionOf(
        row,
        messages.filter((message) => message.discussionId === row.id),
        planners.get(row.missionId) ?? NO_PLANNER,
        waiting,
      ),
    )
  })

/** A mission's discussions, in the order opened. */
export const discussionsIn = (reader: Reader, missionId: string) =>
  Effect.gen(function* () {
    const rows = yield* reader
      .select()
      .from(discussions)
      .where(eq(discussions.missionId, missionId))
      .orderBy(asc(discussions.number))
      .pipe(Effect.mapError(refusedWhile('reading the discussions')))
    return yield* withMessages(reader, rows)
  })

/** A mission's discussions, open and closed. */
export const discussionsOf = (missionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    return yield* discussionsIn(database, missionId)
  })

/** One discussion, whole. */
export const readDiscussion = (discussionId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(discussions)
      .where(eq(discussions.id, discussionId))
      .pipe(Effect.mapError(refusedWhile('reading the discussion')))
    const [found] = yield* withMessages(database, rows)
    if (found === undefined) return yield* new UnknownDiscussion({ id: discussionId })
    return found
  })

/** The open discussions of a mission, as completeness and Freeze (#92) name them. */
export const openDiscussionsIn = (transaction: EngineTransaction, missionId: string) =>
  transaction
    .select()
    .from(discussions)
    .where(and(eq(discussions.missionId, missionId), eq(discussions.state, 'open')))
    .orderBy(asc(discussions.number))
    .pipe(
      Effect.mapError(refusedWhile('reading the open discussions')),
      Effect.map((rows) =>
        rows.map((row) => ({ label: labelOf(row.number), item: itemSaid(itemOf(row)) })),
      ),
    )

/**
 * What completeness and Freeze (#92) read of the inputs, the questions and the discussions: #86's
 * pending inputs, a Discuss decision still proposed in its open discussion marked `proposed` (it
 * waits on the user, not on the Planner), and the open discussions.
 */
export const pendingWithDiscussionsIn = (transaction: EngineTransaction, missionId: string) =>
  Effect.gen(function* () {
    const pending = yield* pendingIn(transaction, missionId)
    const open = yield* openDiscussionsIn(transaction, missionId)
    const proposed = (input: (typeof pending.pendingInputs)[number]) =>
      input.kind === 'discuss_decision' && open.some((one) => one.label === input.item)
    return {
      ...pending,
      pendingInputs: pending.pendingInputs.map((input) => ({
        id: input.id,
        kind: input.kind,
        item: input.item,
        version: input.version,
        state: proposed(input) ? ('proposed' as const) : input.state,
      })),
      openDiscussions: open,
    }
  })

/**
 * The ball of these missions' open discussions (#34): one waits on the user when the agent spoke
 * last or proposed, when its Planner failed, or when the Planner took the user's last message and
 * went idle without a reply; one where the user spoke last has the agent working only while a
 * Planner lives and is starting, in a turn, or about to take it.
 */
export const discussionBalls = (missionIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(discussions)
      .where(and(inArray(discussions.missionId, [...missionIds]), eq(discussions.state, 'open')))
      .pipe(Effect.mapError(refusedWhile('reading the open discussions')))
    const balls = new Map<string, { waitingOnYou: boolean; agentWorking: boolean }>()
    const planners = yield* plannersNow(database, missionIds)
    for (const one of yield* withMessages(database, rows)) {
      const ball = balls.get(one.missionId) ?? { waitingOnYou: false, agentWorking: false }
      if (one.waitsOn === 'user') ball.waitingOnYou = true
      if (one.waitsOn === 'agent' && planners.get(one.missionId)?.live === true) {
        ball.agentWorking = true
      }
      balls.set(one.missionId, ball)
    }
    return balls
  })

/** A discussion as the Planner is handed it: the item, its content now, the whole exchange. */
export const discussionSaid = (discussion: Discussion, content: string | null): string =>
  [
    `Discussion ${discussion.label} on ${itemSaid(discussion.item)}, opened by the user.`,
    ...(content === null ? [] : [`${itemSaid(discussion.item)} as it stands:\n\n${content}`]),
    [
      'The discussion so far:',
      ...discussion.messages.map((message) => {
        const who =
          message.author === 'user' ? 'The user' : message.proposal ? 'You proposed' : 'You'
        return `- ${who}: ${message.text}`
      }),
    ].join('\n'),
  ].join('\n\n')

/** The open discussions in a Planner's brief, and whether one waits on it (mode `discuss`). */
export const discussionsBrief = (spec: Spec, open: ReadonlyArray<Discussion>) => ({
  text:
    open.length === 0
      ? null
      : open
          .map((one) =>
            discussionSaid(
              one,
              one.item.kind === 'question' ? null : itemContent(spec, one.item, null),
            ),
          )
          .join('\n\n'),
  discussing: open.some((one) => one.waitsOn === 'agent'),
})

/** A message added to a discussion: a domain event the streams follow, with no Journal line. */
export const messageEvent = (row: DiscussionRow, author: 'user' | 'agent'): NewEvent => ({
  type: 'planning.discussion_message',
  entityKind: 'mission',
  entityId: row.missionId,
  source: author === 'user' ? 'ui' : 'system',
  author: author === 'user' ? 'human' : 'agent',
  payload: { discussionId: row.id, discussion: labelOf(row.number), by: author },
})

/** A discussion of a mission, by the label the Planner names it with (`#12`, or `12`). */
const numbered = (transaction: EngineTransaction, missionId: string, named: string) =>
  Effect.gen(function* () {
    const number = Number(/^#?(\d+)$/.exec(named.trim())?.[1] ?? Number.NaN)
    if (!Number.isInteger(number)) return null
    const [row] = yield* transaction
      .select()
      .from(discussions)
      .where(and(eq(discussions.missionId, missionId), eq(discussions.number, number)))
      .pipe(Effect.mapError(refusedWhile('reading the discussion')))
    return row ?? null
  })

type Said = { readonly refused: string } | { readonly done: string }

/** The Planner's message in a discussion of its mission, a proposal or a reply. */
const agentSays = (grant: Grant, named: string, text: string, proposal: boolean) =>
  Effect.gen(function* () {
    const missionId = grant.missionId
    if (missionId === null) return refusal('refused: this session works for no mission')
    const secrets = yield* Secrets
    const said = secrets.mask(text.trim())
    if (said === '') return refusal('refused: say something.')
    const outcome = yield* mutate(
      proposal ? 'proposing a decision' : 'replying in a discussion',
      (transaction) =>
        Effect.gen(function* () {
          const answer = (result: Said) => ({ result, events: [] })
          const [mission] = yield* transaction
            .select()
            .from(missions)
            .where(eq(missions.id, missionId))
            .pipe(Effect.mapError(refusedWhile('reading the mission')))
          if (mission === undefined) return answer({ refused: 'this mission no longer exists.' })
          const key = missionKey(mission.keyPrefix, mission.keyNumber)
          if (mission.stage !== 'planning') return answer({ refused: notPlanningSaid(key) })
          const row = yield* numbered(transaction, missionId, named)
          if (row === null) return answer({ refused: `${key} has no discussion ${named.trim()}.` })
          const label = labelOf(row.number)
          if (row.state !== 'open') return answer({ refused: closedSaid(label) })
          const at = new Date().toISOString()
          yield* transaction
            .insert(discussionMessages)
            .values({ discussionId: row.id, author: 'agent', text: said, proposal, at })
            .pipe(Effect.mapError(refusedWhile('writing the message')))
          const events: NewEvent[] = [messageEvent(row, 'agent')]
          if (proposal) {
            // Each proposal of a discussion has its own time: it names the one the user accepts.
            const proposedAt =
              row.proposedAt !== null && at <= row.proposedAt
                ? new Date(Date.parse(row.proposedAt) + 1).toISOString()
                : at
            yield* transaction
              .update(discussions)
              .set({ proposal: said, proposedAt })
              .where(eq(discussions.id, row.id))
              .pipe(Effect.mapError(refusedWhile('keeping the proposal')))
            yield* discussionInputs.proposed(transaction, {
              missionId,
              label,
              said: `The decision proposed in ${label} on ${itemSaid(itemOf(row))}: ${said}`,
            })
            events.push({
              type: 'planning.decision_proposed',
              entityKind: 'mission',
              entityId: missionId,
              source: 'system',
              author: 'agent',
              payload: {
                discussionId: row.id,
                discussion: label,
                item: itemSaid(itemOf(row)),
                text: said,
                sessionId: grant.sessionId,
                role: grant.role,
              },
            })
          }
          return { result: { done: label }, events }
        }),
    )
    if ('refused' in outcome) return refusal(`refused: ${outcome.refused}`)
    return answered(
      proposal
        ? `Your proposal is pending in ${outcome.done}: the user accepts it, writes another decision, or ends the discussion without one.`
        : `Your reply is in ${outcome.done}.`,
    )
  }).pipe(Effect.catch((failed) => Effect.succeed(failure(`the call failed: ${failed.message}`))))

export const discussionReply = (grant: Grant, args: ToolArguments<'discussion_reply'>) =>
  agentSays(grant, args.discussion, args.text, false)

export const discussionProposeDecision = (
  grant: Grant,
  args: ToolArguments<'discussion_propose_decision'>,
) => agentSays(grant, args.discussion, args.decision, true)
