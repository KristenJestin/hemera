/**
 * What a human decides of a command the agent proposed (design D8-11, D8-16).
 *
 * The agent proposes through `commands_propose`, which writes a `command_proposal` entry in the
 * thread and nothing else; this is the other half, and the only one that writes the catalogue.
 * Accepting saves the entry through `Commands.save` — the very use case the Project settings
 * call — and marks the proposal `accepted`; declining marks it `declined`. A proposal is decided
 * once: a second decision is refused, and a name the catalogue took in the meantime fails the
 * acceptance and leaves the proposal `pending`, for the human to decline or to rename by hand.
 */

import { type Command, COMMAND_TYPES, type DuplicateCommandNameError } from '@hemera/core'
import { and, eq } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { z } from 'zod'

import { AgentNotices } from '../agents/notices.ts'
import { Sessions } from '../sessions.ts'
import { Database, DatabaseError } from '../storage/database.ts'
import { sessionEntries } from '../storage/schema.ts'
import { Commands } from './service.ts'

/** A proposal was asked for by an identifier no entry of the Session carries. */
export class UnknownProposalError extends Error {
  constructor(readonly proposalId: string) {
    super(`this Session has no proposal with the identifier "${proposalId}"`)
    this.name = 'UnknownProposalError'
  }
}

/** A proposal already accepted or declined was decided again. */
export class ProposalDecidedError extends Error {
  constructor(
    readonly proposalId: string,
    readonly outcome: string,
  ) {
    super(`this proposal was already ${outcome}`)
    this.name = 'ProposalDecidedError'
  }
}

/** What a proposal entry carries, as `commands_propose` wrote it. */
const PROPOSAL = z.object({
  proposalId: z.string(),
  name: z.string(),
  line: z.string(),
  type: z.enum(COMMAND_TYPES),
  folder: z.string().nullable(),
  why: z.string(),
  state: z.enum(['pending', 'accepted', 'declined']),
})

type Proposal = z.infer<typeof PROPOSAL>

/** What deciding a proposal can be refused with. */
type Refusal = DatabaseError | UnknownProposalError | ProposalDecidedError

export interface ProposalsService {
  /** Writes the proposed command into the catalogue, and marks the proposal `accepted`. */
  readonly accept: (
    sessionId: string,
    proposalId: string,
  ) => Effect.Effect<Command, Refusal | DuplicateCommandNameError>
  /** Marks the proposal `declined`: nothing enters the catalogue. */
  readonly decline: (sessionId: string, proposalId: string) => Effect.Effect<void, Refusal>
}

export class Proposals extends Context.Service<Proposals, ProposalsService>()('Proposals') {}

export const proposalsLayer: Layer.Layer<
  Proposals,
  never,
  Sessions | Commands | Database | AgentNotices
> = Layer.effect(
  Proposals,
  Effect.gen(function* () {
    const database = yield* Database
    const sessions = yield* Sessions
    const commands = yield* Commands
    const notices = yield* AgentNotices

    /** A write of another service, as the one refusal this service declares for the storage. */
    const stored =
      (doing: string) =>
      <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, DatabaseError> =>
        effect.pipe(
          Effect.mapError((cause) =>
            cause instanceof DatabaseError ? cause : new DatabaseError({ doing, cause }),
          ),
        )

    /** The proposal a Session holds under that identifier, still `pending`. */
    const pending = (sessionId: string, proposalId: string) =>
      Effect.gen(function* () {
        const rows = yield* database
          .select({ payload: sessionEntries.payload })
          .from(sessionEntries)
          .where(
            and(
              eq(sessionEntries.sessionId, sessionId),
              eq(sessionEntries.correlationId, `proposal:${proposalId}`),
            ),
          )
          .limit(1)
          .pipe(
            Effect.mapError((cause) => new DatabaseError({ doing: 'reading the proposal', cause })),
          )
        const read = PROPOSAL.safeParse(JSON.parse(rows[0]?.payload ?? 'null'))
        if (!read.success) return yield* Effect.fail(new UnknownProposalError(proposalId))
        if (read.data.state !== 'pending') {
          return yield* Effect.fail(new ProposalDecidedError(proposalId, read.data.state))
        }
        return read.data
      })

    /**
     * The proposal's entry in its outcome, with the Journal line that says it, in one write
     * (D8-16), and the window told as it is of any entry.
     */
    const decided = (
      sessionId: string,
      projectId: string,
      proposal: Proposal,
      outcome: 'accepted' | 'declined',
      payload: Readonly<Record<string, string>>,
    ) =>
      Effect.gen(function* () {
        const written = yield* sessions
          .write(sessionId, {
            role: 'hemera',
            kind: 'command_proposal',
            body: proposal.name,
            payload: JSON.stringify({ ...proposal, state: outcome }),
            correlationId: `proposal:${proposal.proposalId}`,
            state: outcome,
            events: [
              {
                type: `command.${outcome}`,
                entityKind: 'command',
                entityId: proposal.proposalId,
                source: 'ui',
                author: 'human',
                projectId,
                sessionId,
                payload: { name: proposal.name, type: proposal.type, ...payload },
              },
            ],
          })
          .pipe(stored('writing the proposal'))
        notices.wrote(sessionId, written.entry)
      })

    /** The Project a Session belongs to, which is the catalogue a proposal is for. */
    const projectOf = (sessionId: string) =>
      sessions.one(sessionId).pipe(
        stored('reading the Session of a proposal'),
        Effect.map(({ session }) => session.projectId),
      )

    return {
      accept: (sessionId, proposalId) =>
        Effect.gen(function* () {
          const proposal = yield* pending(sessionId, proposalId)
          const projectId = yield* projectOf(sessionId)
          // The catalogue is written by the use case the settings call, and only here (D8-11):
          // a name taken since the proposal fails it, and the proposal stays `pending`.
          const command = yield* commands.save(
            {
              projectId,
              name: proposal.name,
              line: proposal.line,
              type: proposal.type,
              // A proposal names the root or one of the Project's repositories: the command runs
              // under that base, in the base itself (D8-07 as amended by recette 1).
              folderBase: proposal.folder,
              folder: null,
              lineWindows: null,
              lineLinux: null,
              scope: 'workspace',
              portless: false,
              portlessName: null,
            },
            false,
          )
          yield* decided(sessionId, projectId, proposal, 'accepted', { commandId: command.id })
          return command
        }).pipe(Effect.provideService(Database, database)),

      decline: (sessionId, proposalId) =>
        Effect.gen(function* () {
          const proposal = yield* pending(sessionId, proposalId)
          yield* decided(sessionId, yield* projectOf(sessionId), proposal, 'declined', {})
        }).pipe(Effect.provideService(Database, database)),
    }
  }),
)
