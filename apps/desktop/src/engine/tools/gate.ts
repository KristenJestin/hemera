/**
 * The single execution gate: every call of every Hemera tool, from every role, goes through
 * `ToolGate.call`, in this order.
 *
 *  1. the session exists and holds a live grant (a revoked or replaced token never gets here);
 *  2. the tool is one of the session's (else a refusal);
 *  3. the arguments decode with the tool's `Schema` (else a refusal naming the field);
 *  4. the role's mandatory guards, never lifted by any verdict: writing is allowed for the role (a
 *     write tool, or a command that is not a read-only check, from a read-only role is refused),
 *     then the guards later tickets register, in their order;
 *  5. for a workflow tool that takes a path: the places rule (refused outside the role's place or
 *     in a sensitive place, never asked);
 *  6. for a local or judged call: the verdict (`allow`, `ask` with Hemera's reason, or `deny`);
 *  7. on `ask`: the single human question, which answers the agent at once;
 *  8. idempotency: the same call key in the same session gives the same outcome, one execution
 *     and one record, and a retry that arrives while the first call runs waits for it;
 *  9. the execution, whose effects outside the database record their intent and outcome, only
 *     while the grant is still live, and counted until it ends (`ToolAccess.settled`);
 * 10. the record of the call: session, role, mission, tool, class, verdict and who gave it,
 *     outcome, duration; its reason masked, never a file's content.
 *
 * Refusals are values, never thrown errors: the agent is told what was refused and why. The gate
 * never reads the agent's own permission mode: the verdict is the same whatever mode it stands on.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  MASK,
  HELPER_DEPTH,
  ROLE_NAMES,
  ROLE_PLACES,
  ROOT_REPOSITORY,
  TOOLS,
  TOOL_NAMES,
  type ToolArguments,
  type ToolName,
  admitTool,
  lineFor,
  NESTING_LIMIT,
  maskedJson,
  neutralised,
} from '@hemera/core/domain'
import { formatSchemaError } from '@hemera/core/schema'
import type { Command } from '@hemera/ipc'
import { Context, Deferred, Effect, Layer, Option, Predicate, Result, Schema } from 'effect'
import type { Scope } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { getAgentSession } from '../agents/sessions.ts'
import { agentText, nestsPastLimit } from '../agents/text.ts'
import { type RoleSession, getSession, sessionsOfLineage } from '../sessions/store.ts'
import { getCommand } from '../catalogue.ts'
import type { DomainEvents } from '../domain-events.ts'
import { getProject } from '../projects.ts'
import { evidenceRead, reviewHeld } from '../review/gate.ts'
import type { RunServices } from '../runs.ts'
import { Secrets, type SecretsRegistry, maskedHead } from '../secrets.ts'
import { refusedWhile } from '../storage/database.ts'
import type { Database } from '../storage/database.ts'
import { toolCalls } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'
import { type Grant, ToolAccess } from './access.ts'
import type { ActionOwner, EffectfulActions } from './actions.ts'
import {
  commandsList,
  commandsOutput,
  commandsRun,
  commandsStop,
  runnableReadOnly,
} from './commands.ts'
import {
  type FileCall,
  ReadVersions,
  type ToolAnswer,
  fsEdit,
  fsList,
  fsRead,
  fsWrite,
  refusal,
  search,
} from './files.ts'
import {
  type Evidence,
  type Memory,
  type MissionDependencies,
  SessionEpochs,
} from '../memory/index.ts'
import {
  evidenceAdd,
  journalAdd,
  memoryRead,
  noteAdd,
  notesCondense,
  nowSet,
} from '../memory/tools.ts'
import { missionsList, specCreateDraft } from '../chat/tools.ts'
import type { MissionActivity } from '../missions.ts'
import type { MissionStarts } from '../start/started.ts'
import { Git } from '../git.ts'
import { GitGuard, actionIn } from '../git-guard.ts'
import type { SpecBoard } from '../planning/board.ts'
import { BuildDesk } from '../building/desk.ts'
import { HelperDesk } from '../building/helper-desk.ts'
import { STOPPED_AT_THE_END } from '../building/helper-store.ts'
import { DocsDesk } from '../building/docs-desk.ts'
import { ReviewDesk } from '../building/review-desk.ts'
import { RoundDesk } from '../review/round-desk.ts'
import { ProbeDesk } from '../planning/probe-desk.ts'
import type { AgentOffers } from '../planning/offers.ts'
import { modelRecommend, proofWrite, tasksWrite } from '../planning/plan-tools.ts'
import { coldReadFixedTool, coldReadReportTool } from '../planning/cold-read-store.ts'
import type { RepositoryStatuses } from '../repositories.ts'
import {
  askWaveTool,
  declareCompleteTool,
  inputIntegratedTool,
  missionDescribe,
  questionDraftMessageTool,
  questionRetireTool,
  requirementRemove,
  requirementWrite,
  specRead,
  specWriteSection,
  triageAnswer,
} from '../planning/tools.ts'
import {
  livingDomainPropose,
  livingRequirementObsolete,
  livingRequirementPropose,
  livingSpecDone,
  livingSpecRead,
} from '../living-spec/tools.ts'
import type { ProfileHome } from '../profile-home.ts'
import { discussionProposeDecision, discussionReply } from '../planning/discussion-store.ts'
import { dependencyProposeTool, reliesOnWriteTool } from '../planning/dependencies.ts'
import { answerProposeTool } from '../planning/proposals-store.ts'
import { ticketEventReportTool } from '../tickets/event-report.ts'
import { prelaunchReportTool } from '../building/report.ts'
import { prototypeReadTool } from '../building/prototype-files.ts'
import type { TesterFindings } from '../tester/findings.ts'
import { hemeraReport, hemeraReports } from '../tester/tools.ts'
import type { GhCli } from '../tickets/gh.ts'
import type { JiraLink } from '../tickets/jira-link.ts'
import type { TicketProviders } from '../tickets/search.ts'
import { ticketRead } from '../tickets/tool.ts'
import { resolvePath } from './paths.ts'
import {
  type CallSession,
  type FrozenCall,
  GateGuards,
  type JudgedCall,
  type JudgedPath,
  PermissionRequests,
  SensitiveLinks,
  SensitivePlaces,
  SessionNotes,
  SetupDesk,
  Verdicts,
  WriteAttribution,
  outsideReason,
} from './ports.ts'
import { Withholding } from './withholding.ts'

export type { ToolAnswer }

/** One call as the server hands it over. */
export interface ToolCallAsked {
  /** The grant the request's token named. */
  readonly grantId: string
  /** The tool as the agent named it. */
  readonly tool: string
  readonly arguments: Schema.Json
  /** The agent's own key of the call, when its request carries one: what a retry is known by. */
  readonly callKey: string | null
}

/** What came of acting on a call the user allowed. */
export type Performed =
  | { readonly kind: 'answered'; readonly answer: ToolAnswer }
  /** Something it was allowed on no longer holds: nothing ran. */
  | { readonly kind: 'changed'; readonly reason: string }

export class ToolGate extends Context.Service<
  ToolGate,
  {
    readonly call: (asked: ToolCallAsked) => Effect.Effect<ToolAnswer>
    /**
     * Acts on a call the user allowed, through the same steps, `holds` saying what else no longer
     * holds (null when everything does).
     */
    readonly perform: (
      frozen: FrozenCall,
      holds: (call: JudgedCall) => Effect.Effect<string | null>,
    ) => Effect.Effect<Performed>
  }
>()('ToolGate') {}

/** What the gate stands on. */
export type GateServices =
  | Database
  | DomainEvents
  | Secrets
  | RunServices
  | ToolAccess
  | Verdicts
  | PermissionRequests
  | SensitivePlaces
  | GateGuards
  | WriteAttribution
  | EffectfulActions
  | Memory
  | Evidence
  | MissionDependencies
  | SessionEpochs
  | SessionNotes
  | MissionActivity
  | SetupDesk
  | TesterFindings
  | MissionStarts
  | SpecBoard
  | Git
  | GitGuard
  | ProfileHome
  | ProbeDesk
  | BuildDesk
  | HelperDesk
  | DocsDesk
  | ReviewDesk
  | RoundDesk
  | AgentOffers
  | RepositoryStatuses
  | GhCli
  | JiraLink
  | TicketProviders

/**
 * How many answered keys a session keeps against a retry, and how many sessions keep theirs, the
 * least recently asked let go of first: a retry comes seconds after the answer it lost.
 */
const KEYS_KEPT = 32
const SESSIONS_KEPT = 64

/** The longest reason a record keeps. */
const REASON_KEPT = 500

/** How much of a call's arguments its record keeps: enough to read it, never a whole file. */
const ARGUMENTS_KEPT = 2000

const readProposedChanges = Schema.decodeUnknownOption(
  Schema.Struct({ changes: Schema.Array(Schema.Record(Schema.String, Schema.Json)) }),
)

/**
 * The arguments of a call as a record may hold them: a setup proposal's values by their name,
 * `value`, as `•••`, whatever their length; masking alone would keep a short one in clear.
 */
const withoutProposedValues = (tool: string, args: Schema.Json): Schema.Json =>
  tool !== 'setup_propose'
    ? args
    : Option.match(readProposedChanges(args), {
        onNone: () => args,
        onSome: ({ changes }) => ({
          changes: changes.map((change) =>
            Object.fromEntries(
              Object.entries(change).map(([name, value]) => [
                name,
                name === 'value' ? MASK : value,
              ]),
            ),
          ),
        }),
      })

/**
 * How much of a call's arguments is walked before the rest is `•••`: twice what a record keeps,
 * so what is cut at `ARGUMENTS_KEPT` is never short of what was walked.
 */
const ARGUMENTS_WALKED = 2 * ARGUMENTS_KEPT

/** `Array.isArray` does not narrow a read-only array out of a union: this does. */
const isJsonList = (value: Schema.Json): value is Schema.JsonArray => Array.isArray(value)

/** Whether a value is a record of fields, not a list; the arguments are JSON already, decoded once. */
const isJsonObject = (value: Schema.Json): value is Schema.JsonObject => Predicate.isObject(value)

/**
 * A call's arguments cut to what a record keeps of them, before they are masked (#392): a string
 * longer than a record keeps becomes its masked head (`maskedHead`, in slices), what lies past
 * `NESTING_LIMIT` levels is `•••` as the masking makes it, and once `ARGUMENTS_WALKED` characters
 * were walked, the values left are dropped for one `•••`. So the masking of the record walks a few
 * thousand characters, however large or deep the arguments the agent sent.
 */
const cutForRecord = (secrets: SecretsRegistry, record: Schema.JsonObject) => {
  let left = ARGUMENTS_WALKED
  const text = (one: string) =>
    Effect.map(
      one.length <= ARGUMENTS_KEPT ? Effect.succeed(one) : maskedHead(secrets, one, ARGUMENTS_KEPT),
      (kept) => {
        left -= kept.length + 3
        return kept
      },
    )
  const value = (one: Schema.Json, depth: number): Effect.Effect<Schema.Json> => {
    if (Predicate.isString(one)) return text(one)
    if (one === null || Predicate.isNumber(one) || Predicate.isBoolean(one)) {
      left -= 8
      return Effect.succeed(one)
    }
    if (depth >= NESTING_LIMIT) return Effect.succeed(MASK)
    // A list or a record costs its brackets: an empty one is walked too.
    left -= 2
    return isJsonList(one) ? list(one, depth + 1) : fields(one, depth + 1)
  }
  const list = (items: Schema.JsonArray, depth: number) =>
    Effect.gen(function* () {
      const kept: Schema.Json[] = []
      for (const item of items) {
        if (left <= 0) {
          kept.push(MASK)
          break
        }
        kept.push(yield* value(item, depth))
      }
      return kept
    })
  const fields = (named: Schema.JsonObject, depth: number): Effect.Effect<Schema.JsonObject> =>
    Effect.gen(function* () {
      const kept: Array<[string, Schema.Json]> = []
      for (const [name, item] of Object.entries(named)) {
        if (left <= 0) {
          kept.push([MASK, MASK])
          break
        }
        kept.push([yield* text(name), yield* value(item, depth)])
      }
      return Object.fromEntries(kept)
    })
  return fields(record, 1)
}

/**
 * A call's arguments as its record keeps them: cut (`cutForRecord`), masked, then cut again at
 * what a record holds. A request of 16 MiB is never masked whole, at once, for the 2,000
 * characters a record holds of it (#392). They arrive typed `Schema.Json`, decoded once by the
 * server that read them off the wire: they are not decoded again here (#440).
 */
const argumentsKept = (secrets: SecretsRegistry, tool: string, given: Schema.Json) =>
  Effect.gen(function* () {
    const args = withoutProposedValues(tool, given)
    const fields = isJsonObject(args) ? Option.some(args) : Option.none()
    const masked = Option.isNone(fields)
      ? yield* maskedHead(secrets, agentText(args), ARGUMENTS_KEPT + 1)
      : maskedJson(secrets.maskArguments(yield* cutForRecord(secrets, fields.value)))
    return masked.length > ARGUMENTS_KEPT
      ? secrets.mask(`${masked.slice(0, ARGUMENTS_KEPT)}…`)
      : masked
  })

/** A call decoded, its tool and its arguments read by that tool's schema. */
type Decoded = {
  [Name in ToolName]: { readonly tool: Name; readonly args: ToolArguments<Name> }
}[ToolName]

const decoder =
  <Name extends ToolName>(tool: Name, schema: Schema.Decoder<ToolArguments<Name>>) =>
  (raw: Schema.Json) =>
    Schema.decodeUnknownEffect(schema)(raw).pipe(Effect.map((args) => ({ tool, args })))

/** Reads a call's arguments with its tool's schema. */
const decodeCall = (
  tool: ToolName,
  raw: Schema.Json,
): Effect.Effect<Decoded, Schema.SchemaError> => {
  switch (tool) {
    case 'fs_read':
      return decoder(tool, TOOLS.fs_read.input)(raw)
    case 'fs_list':
      return decoder(tool, TOOLS.fs_list.input)(raw)
    case 'search':
      return decoder(tool, TOOLS.search.input)(raw)
    case 'fs_write':
      return decoder(tool, TOOLS.fs_write.input)(raw)
    case 'fs_edit':
      return decoder(tool, TOOLS.fs_edit.input)(raw)
    case 'commands_list':
      return decoder(tool, TOOLS.commands_list.input)(raw)
    case 'commands_run':
      return decoder(tool, TOOLS.commands_run.input)(raw)
    case 'commands_output':
      return decoder(tool, TOOLS.commands_output.input)(raw)
    case 'commands_stop':
      return decoder(tool, TOOLS.commands_stop.input)(raw)
    case 'memory_read':
      return decoder(tool, TOOLS.memory_read.input)(raw)
    case 'now_set':
      return decoder(tool, TOOLS.now_set.input)(raw)
    case 'journal_add':
      return decoder(tool, TOOLS.journal_add.input)(raw)
    case 'note_add':
      return decoder(tool, TOOLS.note_add.input)(raw)
    case 'notes_condense':
      return decoder(tool, TOOLS.notes_condense.input)(raw)
    case 'evidence_add':
      return decoder(tool, TOOLS.evidence_add.input)(raw)
    case 'missions_list':
      return decoder(tool, TOOLS.missions_list.input)(raw)
    case 'spec_create_draft':
      return decoder(tool, TOOLS.spec_create_draft.input)(raw)
    case 'setup_read':
      return decoder(tool, TOOLS.setup_read.input)(raw)
    case 'setup_propose':
      return decoder(tool, TOOLS.setup_propose.input)(raw)
    case 'spec_read':
      return decoder(tool, TOOLS.spec_read.input)(raw)
    case 'spec_write_section':
      return decoder(tool, TOOLS.spec_write_section.input)(raw)
    case 'requirement_write':
      return decoder(tool, TOOLS.requirement_write.input)(raw)
    case 'requirement_remove':
      return decoder(tool, TOOLS.requirement_remove.input)(raw)
    case 'mission_describe':
      return decoder(tool, TOOLS.mission_describe.input)(raw)
    case 'triage_answer':
      return decoder(tool, TOOLS.triage_answer.input)(raw)
    case 'declare_complete':
      return decoder(tool, TOOLS.declare_complete.input)(raw)
    case 'ask_wave':
      return decoder(tool, TOOLS.ask_wave.input)(raw)
    case 'question_retire':
      return decoder(tool, TOOLS.question_retire.input)(raw)
    case 'question_draft_message':
      return decoder(tool, TOOLS.question_draft_message.input)(raw)
    case 'input_integrated':
      return decoder(tool, TOOLS.input_integrated.input)(raw)
    case 'living_spec_read':
      return decoder(tool, TOOLS.living_spec_read.input)(raw)
    case 'living_domain_propose':
      return decoder(tool, TOOLS.living_domain_propose.input)(raw)
    case 'living_requirement_propose':
      return decoder(tool, TOOLS.living_requirement_propose.input)(raw)
    case 'living_requirement_obsolete':
      return decoder(tool, TOOLS.living_requirement_obsolete.input)(raw)
    case 'living_spec_done':
      return decoder(tool, TOOLS.living_spec_done.input)(raw)
    case 'probe_launch':
      return decoder(tool, TOOLS.probe_launch.input)(raw)
    case 'probe_read':
      return decoder(tool, TOOLS.probe_read.input)(raw)
    case 'probe_report':
      return decoder(tool, TOOLS.probe_report.input)(raw)
    case 'proof_write':
      return decoder(tool, TOOLS.proof_write.input)(raw)
    case 'tasks_write':
      return decoder(tool, TOOLS.tasks_write.input)(raw)
    case 'model_recommend':
      return decoder(tool, TOOLS.model_recommend.input)(raw)
    case 'discussion_reply':
      return decoder(tool, TOOLS.discussion_reply.input)(raw)
    case 'discussion_propose_decision':
      return decoder(tool, TOOLS.discussion_propose_decision.input)(raw)
    case 'ticket_read':
      return decoder(tool, TOOLS.ticket_read.input)(raw)
    case 'cold_read_report':
      return decoder(tool, TOOLS.cold_read_report.input)(raw)
    case 'cold_read_fixed':
      return decoder(tool, TOOLS.cold_read_fixed.input)(raw)
    case 'dependency_propose':
      return decoder(tool, TOOLS.dependency_propose.input)(raw)
    case 'relies_on_write':
      return decoder(tool, TOOLS.relies_on_write.input)(raw)
    case 'answer_propose':
      return decoder(tool, TOOLS.answer_propose.input)(raw)
    case 'ticket_event_report':
      return decoder(tool, TOOLS.ticket_event_report.input)(raw)
    case 'prelaunch_report':
      return decoder(tool, TOOLS.prelaunch_report.input)(raw)
    case 'docs_report':
      return decoder(tool, TOOLS.docs_report.input)(raw)
    case 'checkpoint_read':
      return decoder(tool, TOOLS.checkpoint_read.input)(raw)
    case 'evidence_read':
      return decoder(tool, TOOLS.evidence_read.input)(raw)
    case 'review_report':
      return decoder(tool, TOOLS.review_report.input)(raw)
    case 'build_read':
      return decoder(tool, TOOLS.build_read.input)(raw)
    case 'task_start':
      return decoder(tool, TOOLS.task_start.input)(raw)
    case 'task_finished':
      return decoder(tool, TOOLS.task_finished.input)(raw)
    case 'task_blocked':
      return decoder(tool, TOOLS.task_blocked.input)(raw)
    case 'report_need':
      return decoder(tool, TOOLS.report_need.input)(raw)
    case 'need_propose':
      return decoder(tool, TOOLS.need_propose.input)(raw)
    case 'proof_run':
      return decoder(tool, TOOLS.proof_run.input)(raw)
    case 'build_summary':
      return decoder(tool, TOOLS.build_summary.input)(raw)
    case 'helper_launch':
      return decoder(tool, TOOLS.helper_launch.input)(raw)
    case 'helper_read':
      return decoder(tool, TOOLS.helper_read.input)(raw)
    case 'prototype_read':
      return decoder(tool, TOOLS.prototype_read.input)(raw)
    case 'helper_result':
      return decoder(tool, TOOLS.helper_result.input)(raw)
    case 'hemera_report':
      return decoder(tool, TOOLS.hemera_report.input)(raw)
    case 'hemera_reports':
      return decoder(tool, TOOLS.hemera_reports.input)(raw)
    case 'round_point_write':
      return decoder(tool, TOOLS.round_point_write.input)(raw)
    case 'round_point_remove':
      return decoder(tool, TOOLS.round_point_remove.input)(raw)
    case 'round_tasks_write':
      return decoder(tool, TOOLS.round_tasks_write.input)(raw)
    case 'round_propose_mission':
      return decoder(tool, TOOLS.round_propose_mission.input)(raw)
    case 'round_ready':
      return decoder(tool, TOOLS.round_ready.input)(raw)
    case 'feedback_answer':
      return decoder(tool, TOOLS.feedback_answer.input)(raw)
  }
}

/** The repository a call names, and the path its paths start from; a refusal when it has none. */
const baseOf = (grant: Grant, repository: string | undefined) =>
  Effect.gen(function* () {
    if (repository === undefined) return Result.succeed(grant.place.root)
    // A place that reads a Workspace beside its own folder finds the repositories there (#145).
    const root = grant.place.readable ?? grant.place.root
    const wanted = repository.replace(/^\.\//, '').replace(/[\\/]+$/, '') || ROOT_REPOSITORY
    const project = yield* getProject(grant.projectId)
    const found = project.repositories.find((one) => one.path === wanted)
    if (found === undefined) {
      return Result.fail(
        refusal(
          `refused: the Project has no repository ${repository}: it has ${project.repositories.map((one) => one.path).join(', ')}`,
        ),
      )
    }
    return Result.succeed(found.path === ROOT_REPOSITORY ? root : join(root, found.path))
  })

/** The path a call acts on, resolved; null for a tool that takes none. */
const targetOf = (grant: Grant, decoded: Decoded, home: string) =>
  Effect.gen(function* () {
    const named =
      decoded.tool === 'fs_read' ||
      decoded.tool === 'fs_list' ||
      decoded.tool === 'fs_write' ||
      decoded.tool === 'fs_edit'
        ? { repository: decoded.args.repository, path: decoded.args.path }
        : decoded.tool === 'search'
          ? { repository: decoded.args.repository, path: '.' }
          : decoded.tool === 'evidence_add' && decoded.args.path !== undefined
            ? { repository: undefined, path: decoded.args.path }
            : null
    if (named === null) return Result.succeed<JudgedPath | null>(null)
    const base = yield* baseOf(grant, named.repository)
    if (Result.isFailure(base)) return Result.fail(base.failure)
    const resolved = yield* Effect.promise(() =>
      resolvePath(grant.place.root, base.success, named.path, home),
    )
    return Result.succeed<JudgedPath | null>({
      named: named.path,
      from: base.success,
      resolved: resolved.path,
      inside: resolved.inside,
      certain: resolved.certain,
    })
  })

/**
 * The places rule of Hemera's own workflow tools: a path that is not certainly inside the role's
 * place, or that is in a sensitive place, is refused with its reason, never asked.
 */
export const placesForWorkflow = (
  session: CallSession,
  path: JudgedPath,
  home: string = homedir(),
  writes = true,
) =>
  Effect.gen(function* () {
    if (!path.inside || !path.certain) return `refused: ${outsideReason(session, path, home)}`
    const sensitive = yield* SensitivePlaces.use((places) =>
      places.sensitive(path.resolved, { session, writes }),
    )
    return sensitive === null ? null : `refused: ${sensitive}`
  })

/** What a read of a file with an uncommitted change says (CT-23): the base commit may not hold it. */
export const UNCOMMITTED_CHANGE = 'This file has an uncommitted change in the main checkout.'

/**
 * A mission's session reading the main checkout (the Planner, every Planning role) is told when
 * the file it read is modified, added or untracked there; the read itself is never refused.
 */
const uncommittedNoted = (grant: Grant, path: string, answer: ToolAnswer) =>
  Effect.gen(function* () {
    if (!answer.ok || grant.missionId === null || !grant.mainCheckout) return answer
    const changed = yield* Git.use((git) => git.fileChanged(path)).pipe(
      Effect.orElseSucceed(() => false),
    )
    return changed ? { ...answer, text: `${answer.text}\n\n${UNCOMMITTED_CHANGE}` } : answer
  })

/** A call past steps 2 to 4: decoded, resolved, its command found, its role's guards passed. */
interface Prepared {
  readonly session: CallSession
  readonly name: ToolName
  readonly effect: (typeof TOOLS)[ToolName]['effect']
  readonly call: Decoded
  readonly path: JudgedPath | null
  readonly command: Command | null
  /** What the verdict is asked about; null for a workflow tool, which never asks. */
  readonly judged: JudgedCall | null
  /** What a guard that let the call on after a wait tells the session (#142). */
  readonly notes: ReadonlyArray<string>
}

/** What the record of one call carries beside its outcome. */
interface Noted {
  gateClass: string | null
  verdict: string | null
  verdictBy: string | null
}

export interface GateSettings {
  readonly log: Log
  /** What `~` stands for; the user's home folder unless a test says otherwise. */
  readonly home?: string | undefined
}

export const toolGateLayer = (settings: GateSettings) =>
  Layer.effect(
    ToolGate,
    Effect.gen(function* () {
      const context = yield* Effect.context<GateServices | Scope.Scope>()
      const scope = yield* Effect.scope
      const home = settings.home ?? homedir()
      const versions = new ReadVersions()
      const answeredKeys = new Map<string, Map<string, ToolAnswer>>()
      const inFlight = new Map<string, Deferred.Deferred<ToolAnswer>>()

      /** Writes the record of a call; a refusal of the data folder is said in the diagnostic. */
      const record = (
        grant: Grant,
        tool: string,
        noted: Noted,
        answer: ToolAnswer,
        callKey: string | null,
        began: number,
        args: Schema.Json | null = null,
      ) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const outcome = answer.ok ? 'done' : answer.refused ? 'refused' : 'failed'
          const kept = args === null ? null : yield* argumentsKept(secrets, tool, args)
          yield* mutate('recording a tool call', (transaction) =>
            transaction
              .insert(toolCalls)
              .values({
                id: crypto.randomUUID(),
                sessionId: grant.sessionId,
                role: grant.role,
                projectId: grant.projectId,
                missionId: grant.missionId,
                tool: tool.slice(0, 64),
                gateClass: noted.gateClass,
                verdict: noted.verdict,
                verdictBy: noted.verdictBy,
                outcome,
                reason: answer.ok ? null : secrets.mask(answer.text.slice(0, REASON_KEPT)),
                arguments: kept,
                callKey,
                durationMs: Math.round(performance.now() - began),
                calledAt: new Date().toISOString(),
              })
              .pipe(
                Effect.mapError(refusedWhile('recording a tool call')),
                Effect.as({ result: undefined, events: [] }),
              ),
          ).pipe(
            Effect.catch((failed) =>
              Effect.sync(() =>
                settings.log(`a call of ${tool} was not recorded: ${failed.message}`),
              ),
            ),
          )
        })

      const ownerOf = (grant: Grant): ActionOwner =>
        grant.missionId === null
          ? { kind: 'project', projectId: grant.projectId }
          : { kind: 'mission', missionId: grant.missionId, taskId: null }

      /** Steps 2 to 4: the call decoded, resolved and past the role's guards, or its refusal. */
      const prepare = (grant: Grant, tool: string, raw: Schema.Json, noted: Noted) =>
        Effect.gen(function* () {
          const refused = (answer: ToolAnswer): Result.Result<Prepared, ToolAnswer> => {
            noted.verdictBy = 'guard'
            return Result.fail(answer)
          }
          const session: CallSession = {
            sessionId: grant.sessionId,
            role: grant.role,
            projectId: grant.projectId,
            missionId: grant.missionId,
            place: grant.place,
            helper: grant.helper,
          }
          const role = ROLE_NAMES[grant.role]
          // 2. The tool is one of the session's; a helper's helper launches none (#145).
          if (tool === 'helper_launch' && (grant.helper?.depth ?? 0) >= HELPER_DEPTH) {
            return refused(refusal('refused: a helper of a helper cannot launch helpers'))
          }
          const admission = admitTool(grant.role, grant.tools, tool)
          const name = TOOL_NAMES.find((one) => one === tool)
          if (!admission.admitted || name === undefined) {
            return refused(
              refusal(admission.admitted ? `refused: no tool ${tool}` : admission.reason),
            )
          }
          const entry = TOOLS[name]
          noted.gateClass = entry.gate
          // 2. While the user reviews, the mission's sessions write and run nothing (#341).
          const held = yield* reviewHeld(grant.missionId, name)
          if (held !== null) return refused(refusal(held))
          // A proposal's values are masked before its arguments are read, even when they do not.
          if (name === 'setup_propose') yield* SetupDesk.use((desk) => desk.heard(raw))
          // 3. The arguments decode with its schema.
          const decoded = yield* decodeCall(name, raw).pipe(Effect.result)
          if (Result.isFailure(decoded)) {
            return refused(
              refusal(
                `refused: the arguments of ${name} do not read: ${formatSchemaError(decoded.failure)}`,
              ),
            )
          }
          // A call nested past the limit is refused: what a question would keep of it, and run on
          // approval, is a copy cut at the limit, not what the agent sent.
          if (nestsPastLimit(raw)) {
            return refused(
              refusal(
                `refused: the arguments of ${name} nest deeper than ${String(NESTING_LIMIT)} levels; send them flatter`,
              ),
            )
          }
          const call = decoded.success
          const target = yield* targetOf(grant, call, home)
          if (Result.isFailure(target)) return refused(target.failure)
          const path = target.success
          let command: Command | null = null
          if (call.tool === 'commands_run' && call.args.command !== undefined) {
            const found = yield* getCommand(grant.projectId, call.args.command).pipe(
              Effect.map(Option.some),
              Effect.catchTag('UnknownCommand', () => Effect.succeed(Option.none<Command>())),
            )
            if (Option.isNone(found)) {
              return refused(
                refusal(
                  `refused: the catalogue has no command ${call.args.command}: list them with commands_list`,
                ),
              )
            }
            command = found.value
          }

          // 4. The role's mandatory guards, before any verdict.
          const readOnly = ROLE_PLACES[grant.role].readOnly || grant.place.readOnly
          if (readOnly && entry.effect === 'writes') {
            return refused(refusal(`refused: ${role} does not write files`))
          }
          // A folder of its own beside a Workspace it reads (the Prototyper, #145): it writes in its
          // own folder only, never in the Workspace.
          if (
            grant.place.readable !== undefined &&
            entry.effect === 'writes' &&
            (path === null || !path.inside || !path.certain)
          ) {
            return refused(
              refusal(
                `refused: ${role} writes only in its own folder, ${grant.place.root}: the Workspace is read-only to it`,
              ),
            )
          }
          if (readOnly && entry.effect === 'runs') {
            if (call.tool !== 'commands_run') {
              return refused(refusal(`refused: ${role} does not stop runs`))
            }
            if (command === null || !runnableReadOnly(command)) {
              const what = command === null ? 'a command line' : command.name
              return refused(
                refusal(
                  `refused: ${role} runs only the catalogue's read-only checks, and ${what} is not one`,
                ),
              )
            }
          }
          const notes: string[] = []
          for (const guard of yield* GateGuards) {
            const said = yield* guard({ session, tool: name, path })
            if (said === null) continue
            if (Predicate.isString(said)) return refused(refusal(said))
            notes.push(said.note)
          }
          const judged: JudgedCall | null =
            entry.gate === 'workflow'
              ? null
              : {
                  session,
                  tool: name,
                  gate: entry.gate,
                  path,
                  links: new SensitiveLinks(),
                  command:
                    command === null
                      ? null
                      : {
                          id: command.id,
                          name: command.name,
                          line: lineFor(command, process.platform),
                          check: command.check,
                          readOnly: command.readOnly,
                          askBeforeRunning: command.askBeforeRunning,
                          writeGlobs: command.writeGlobs,
                        },
                  line: call.tool === 'commands_run' ? (call.args.line ?? null) : null,
                  folder:
                    call.tool === 'commands_run' && call.args.command === undefined
                      ? (call.args.repository ?? null)
                      : null,
                  why:
                    call.tool === 'fs_write' ||
                    call.tool === 'fs_edit' ||
                    call.tool === 'commands_run'
                      ? (call.args.why ?? null)
                      : null,
                }
          const prepared: Result.Result<Prepared, ToolAnswer> = Result.succeed({
            session,
            name,
            effect: entry.effect,
            call,
            path,
            command,
            judged,
            notes,
          })
          return prepared
        })

      /**
       * A mission's file write, done once no other task's command holds the file and holding it
       * while it is written (#142): a command never starts in the middle of it.
       */
      const held = <E, R>(
        grant: Grant,
        path: JudgedPath,
        write: Effect.Effect<ToolAnswer, E, R>,
      ) =>
        grant.missionId === null
          ? write
          : WriteAttribution.use((attribution) =>
              attribution.holding(
                {
                  sessionId: grant.sessionId,
                  missionId: grant.missionId ?? '',
                  path: path.resolved,
                },
                write,
              ),
            ).pipe(
              Effect.map(({ result, waited }) =>
                waited === null ? result : { ...result, text: `${result.text}\n\n${waited}` },
              ),
            )

      /**
       * An agent's write, watched by the guard on the engine's Git (#457): what shapes Git in its
       * place is compared before and after it.
       */
      const guarded = <A, E, R>(grant: Grant, write: Effect.Effect<A, E, R>) =>
        Effect.flatMap(actionIn({ projectId: grant.projectId, root: grant.place.root }), (action) =>
          Effect.acquireUseRelease(
            GitGuard.use((guard) => guard.open(action)),
            () => write,
            (close) => close,
          ),
        )

      /** 9. The execution. */
      const execute = (grant: Grant, prepared: Prepared) =>
        Effect.gen(function* () {
          const { call, path } = prepared
          /**
           * A file tool's call; it reads the file of the call the verdict judged, when one did
           * (`./withholding.ts`).
           */
          const fileCall = (resolved: JudgedPath, judged: JudgedCall | null) =>
            Effect.map(
              judged === null
                ? Withholding.of(prepared.session, prepared.judged?.links)
                : Withholding.asked(judged),
              (withholding): FileCall => ({
                sessionId: grant.sessionId,
                owner: ownerOf(grant),
                path: resolved.resolved,
                named: resolved.named,
                versions,
                withholding,
              }),
            )
          const pathOf = (): JudgedPath =>
            path ?? { named: '.', resolved: grant.place.root, inside: true, certain: true }
          switch (call.tool) {
            case 'fs_read': {
              const read = yield* fsRead(yield* fileCall(pathOf(), prepared.judged), call.args)
              return yield* uncommittedNoted(grant, pathOf().resolved, read)
            }
            case 'fs_list':
              return yield* fsList(yield* fileCall(pathOf(), null), call.args)
            case 'search':
              return yield* search(yield* fileCall(pathOf(), null), call.args)
            case 'fs_write':
              return yield* held(
                grant,
                pathOf(),
                guarded(grant, fsWrite(yield* fileCall(pathOf(), prepared.judged), call.args)),
              )
            case 'fs_edit':
              return yield* held(
                grant,
                pathOf(),
                guarded(grant, fsEdit(yield* fileCall(pathOf(), prepared.judged), call.args)),
              )
            case 'commands_list':
              return yield* commandsList(grant)
            case 'commands_run':
              return yield* commandsRun(
                { grant, owner: ownerOf(grant), command: prepared.command, scope },
                call.args,
              )
            case 'commands_output':
              return yield* commandsOutput(grant, call.args)
            case 'commands_stop':
              return yield* commandsStop(grant, call.args)
            case 'memory_read':
              return yield* memoryRead(grant, call.args)
            case 'now_set':
              return yield* nowSet(grant, call.args)
            case 'journal_add':
              return yield* journalAdd(grant, call.args)
            case 'note_add':
              return yield* noteAdd(grant, call.args)
            case 'notes_condense':
              return yield* notesCondense(grant, call.args)
            case 'evidence_add':
              return yield* evidenceAdd(grant, call.args, path === null ? null : path.resolved)
            case 'missions_list':
              return yield* missionsList(grant, call.args)
            case 'spec_create_draft':
              return yield* specCreateDraft(grant, call.args)
            case 'setup_read':
              return yield* SetupDesk.use((desk) => desk.read(grant))
            case 'setup_propose':
              return yield* SetupDesk.use((desk) => desk.propose(grant, call.args))
            case 'spec_read':
              return yield* specRead(grant, call.args)
            case 'spec_write_section':
              return yield* specWriteSection(grant, call.args)
            case 'requirement_write':
              return yield* requirementWrite(grant, call.args)
            case 'requirement_remove':
              return yield* requirementRemove(grant, call.args)
            case 'mission_describe':
              return yield* missionDescribe(grant, call.args)
            case 'triage_answer':
              return yield* triageAnswer(grant, call.args)
            case 'declare_complete':
              return yield* declareCompleteTool(grant, call.args)
            case 'ask_wave':
              return yield* askWaveTool(grant, call.args)
            case 'question_retire':
              return yield* questionRetireTool(grant, call.args)
            case 'question_draft_message':
              return yield* questionDraftMessageTool(grant, call.args)
            case 'input_integrated':
              return yield* inputIntegratedTool(grant, call.args)
            case 'living_spec_read':
              return yield* livingSpecRead(grant, call.args)
            case 'living_domain_propose':
              return yield* livingDomainPropose(grant, call.args)
            case 'living_requirement_propose':
              return yield* livingRequirementPropose(grant, call.args)
            case 'living_requirement_obsolete':
              return yield* livingRequirementObsolete(grant, call.args)
            case 'living_spec_done':
              return yield* livingSpecDone(grant, call.args)
            case 'probe_launch':
              return yield* ProbeDesk.use((desk) => desk.launch(grant, call.args))
            case 'probe_read':
              return yield* ProbeDesk.use((desk) => desk.read(grant, call.args))
            case 'probe_report':
              return yield* ProbeDesk.use((desk) => desk.report(grant, call.args))
            case 'proof_write':
              return yield* proofWrite(grant, call.args)
            case 'tasks_write':
              return yield* tasksWrite(grant, call.args)
            case 'model_recommend':
              return yield* modelRecommend(grant, call.args)
            case 'discussion_reply':
              return yield* discussionReply(grant, call.args)
            case 'discussion_propose_decision':
              return yield* discussionProposeDecision(grant, call.args)
            case 'ticket_read':
              return yield* ticketRead(grant, call.args)
            case 'cold_read_report':
              return yield* coldReadReportTool(grant, call.args)
            case 'cold_read_fixed':
              return yield* coldReadFixedTool(grant, call.args)
            case 'dependency_propose':
              return yield* dependencyProposeTool(grant, call.args)
            case 'relies_on_write':
              return yield* reliesOnWriteTool(grant, call.args)
            case 'answer_propose':
              return yield* answerProposeTool(grant, call.args)
            case 'ticket_event_report':
              return yield* ticketEventReportTool(grant, call.args)
            case 'prelaunch_report':
              return yield* prelaunchReportTool(grant, call.args)
            case 'build_read':
              return yield* BuildDesk.use((desk) => desk.read(grant, call.args))
            case 'task_start':
              return yield* BuildDesk.use((desk) => desk.start(grant, call.args))
            case 'task_finished':
              return yield* BuildDesk.use((desk) => desk.finished(grant, call.args))
            case 'task_blocked':
              return yield* BuildDesk.use((desk) => desk.blocked(grant, call.args))
            case 'report_need':
              return yield* BuildDesk.use((desk) => desk.need(grant, call.args))
            case 'need_propose':
              return yield* BuildDesk.use((desk) => desk.propose(grant, call.args))
            case 'proof_run':
              return yield* BuildDesk.use((desk) => desk.proofRun(grant, call.args))
            case 'build_summary':
              return yield* BuildDesk.use((desk) => desk.summary(grant, call.args))
            case 'helper_launch':
              return yield* HelperDesk.use((desk) => desk.launch(grant, call.args))
            case 'helper_read':
              return yield* HelperDesk.use((desk) => desk.read(grant, call.args))
            case 'prototype_read':
              return yield* prototypeReadTool(grant, call.args, home)
            case 'helper_result':
              return yield* HelperDesk.use((desk) => desk.result(grant, call.args))
            case 'docs_report':
              return yield* DocsDesk.use((desk) => desk.report(grant, call.args))
            case 'checkpoint_read':
              return yield* ReviewDesk.use((desk) => desk.checkpoint(grant, call.args))
            case 'evidence_read':
              return yield* ReviewDesk.use((desk) => desk.evidence(grant, call.args))
            case 'review_report':
              return yield* ReviewDesk.use((desk) => desk.report(grant, call.args))
            case 'hemera_report':
              return yield* hemeraReport(grant, call.args)
            case 'hemera_reports':
              return yield* hemeraReports(call.args)
            case 'round_point_write':
              return yield* RoundDesk.use((desk) => desk.pointWrite(grant, call.args))
            case 'round_point_remove':
              return yield* RoundDesk.use((desk) => desk.pointRemove(grant, call.args))
            case 'round_tasks_write':
              return yield* RoundDesk.use((desk) => desk.tasksWrite(grant, call.args))
            case 'round_propose_mission':
              return yield* RoundDesk.use((desk) => desk.proposeMission(grant, call.args))
            case 'round_ready':
              return yield* RoundDesk.use((desk) => desk.ready(grant, call.args))
            case 'feedback_answer':
              return yield* RoundDesk.use((desk) => desk.answer(grant, call.args))
          }
        })

      /** Steps 2 to 7 and 9: the answer of one call, and what its record notes. */
      const decide = (grant: Grant, asked: ToolCallAsked, noted: Noted) =>
        Effect.gen(function* () {
          const prepared = yield* prepare(grant, asked.tool, asked.arguments, noted)
          if (Result.isFailure(prepared)) return prepared.failure
          const { session, path, judged } = prepared.success

          // An image of a mission's evidence: answered to its own sessions, refused to others (#341).
          if (prepared.success.call.tool === 'fs_read' && path !== null) {
            const evidence = yield* evidenceRead(session, path.resolved)
            if (evidence !== null) {
              noted.verdictBy = 'places'
              return evidence
            }
          }

          if (judged === null) {
            // 5. Workflow tools: the places rule, never a question.
            if (path !== null) {
              const refused = yield* placesForWorkflow(
                session,
                path,
                home,
                prepared.success.effect !== 'reads',
              )
              if (refused !== null) {
                noted.verdictBy = 'places'
                return refusal(refused)
              }
            }
          } else {
            // 6. Local and judged calls: the verdict.
            const verdict = yield* Verdicts.use((verdicts) => verdicts.judge(judged))
            noted.verdict = verdict.verdict
            noted.verdictBy = verdict.by
            if (verdict.verdict === 'deny') return refusal(`refused: ${verdict.reason}`)
            // 7. One human question, answered to the agent at once.
            if (verdict.verdict === 'ask') {
              const frozen: FrozenCall['grant'] = {
                sessionId: grant.sessionId,
                epoch: grant.epoch,
                role: grant.role,
                tools: grant.tools,
                place: grant.place,
                projectId: grant.projectId,
                missionId: grant.missionId,
                workspaceId: grant.workspaceId,
                mainCheckout: grant.mainCheckout,
              }
              const question = yield* PermissionRequests.use((requests) =>
                requests.request({
                  call: judged,
                  frozen: {
                    grant: frozen,
                    tool: prepared.success.name,
                    arguments: asked.arguments,
                  },
                  reason: verdict.reason,
                  sensitive: verdict.sensitive ?? false,
                  settingsSection: verdict.settingsSection ?? null,
                  key: asked.callKey,
                }),
              )
              return refusal(question.answer)
            }
          }
          // A session ended while its call waited executes nothing: its owner may be settling.
          const answer =
            (yield* ToolAccess.use((access) =>
              access.executing(grant.id, execute(grant, prepared.success)),
            )) ?? refusal('refused: this session has ended')
          const notes = prepared.success.notes
          return notes.length === 0
            ? answer
            : { ...answer, text: [answer.text, ...notes].join('\n\n') }
        })

      /**
       * Whether the end of its Building stopped a session's lineage: an approved call of it runs
       * nothing then. One replaced (a restart, a resume) acts on through its successor.
       */
      const stoppedAtTheEnd = (session: RoleSession | null) =>
        session === null
          ? Effect.succeed(false)
          : Effect.map(sessionsOfLineage(session.lineage), (lineage) => {
              const latest = [session, ...lineage].reduce((last, one) =>
                one.epoch >= last.epoch ? one : last,
              )
              return latest.state === 'ended' && latest.stateReason === STOPPED_AT_THE_END
            })

      /**
       * A call the user allowed, acted on by Hemera: its guards, its places and the refusals of the
       * order checked again, then what the caller checks, then the execution through the same
       * steps, recorded as allowed by the user. Whatever no longer holds is said, and nothing runs.
       */
      const perform = (
        frozen: FrozenCall,
        holds: (call: JudgedCall) => Effect.Effect<string | null>,
      ) =>
        Effect.gen(function* () {
          const began = performance.now()
          const grant: Grant = { ...frozen.grant, id: 'approved' }
          const noted: Noted = { gateClass: null, verdict: 'allow', verdictBy: 'user' }
          const performed = yield* Effect.gen(function* () {
            const prepared = yield* prepare(grant, frozen.tool, frozen.arguments, noted)
            if (Result.isFailure(prepared)) {
              return { kind: 'changed', reason: prepared.failure.text } satisfies Performed
            }
            const { judged } = prepared.success
            if (judged === null) {
              return { kind: 'changed', reason: 'it is not a call that asks' } satisfies Performed
            }
            const refused = yield* Verdicts.use((verdicts) => verdicts.refusal(judged))
            if (refused !== null) {
              return { kind: 'changed', reason: `refused: ${refused}` } satisfies Performed
            }
            // Counted before its session's state is read: an exit that stops the session either
            // finds the call counted and waits for it, or stopped the session first and nothing
            // runs. One whose session ended before the exit is refused by the exit's mark.
            const session = yield* getSession(frozen.grant.sessionId).pipe(
              Effect.catchTag('UnknownSession', () => Effect.succeed(null)),
            )
            const acted = yield* ToolAccess.use((access) =>
              access.counted(
                { missionId: frozen.grant.missionId, lineage: session?.lineage ?? null },
                Effect.gen(function* () {
                  if (yield* stoppedAtTheEnd(session)) {
                    return { kind: 'changed', reason: STOPPED_AT_THE_END } satisfies Performed
                  }
                  const changed = yield* holds(judged)
                  if (changed !== null) {
                    return { kind: 'changed', reason: changed } satisfies Performed
                  }
                  const answer = yield* execute(grant, prepared.success)
                  return { kind: 'answered', answer } satisfies Performed
                }),
              ),
            )
            return acted ?? ({ kind: 'changed', reason: STOPPED_AT_THE_END } satisfies Performed)
          }).pipe(
            Effect.catch((failed) =>
              Effect.succeed<Performed>({
                kind: 'answered',
                answer: { ok: false, refused: false, text: `the call failed: ${failed.message}` },
              }),
            ),
          )
          if (performed.kind === 'answered') {
            yield* record(grant, frozen.tool, noted, performed.answer, null, began)
          }
          return performed
        }).pipe(Effect.provide(context))

      /** One call, decided, executed and recorded once. */
      const decided = (grant: Grant, asked: ToolCallAsked) =>
        Effect.gen(function* () {
          const began = performance.now()
          const noted: Noted = { gateClass: null, verdict: null, verdictBy: null }
          const answer = yield* decide(grant, asked, noted).pipe(
            Effect.catch((failed) =>
              Effect.succeed<ToolAnswer>({
                ok: false,
                refused: false,
                text: `the call failed: ${failed.message}`,
              }),
            ),
            Effect.onInterrupt(() =>
              record(
                grant,
                asked.tool,
                noted,
                { ok: false, refused: false, text: 'the agent stopped waiting for this call' },
                asked.callKey,
                began,
                asked.arguments,
              ),
            ),
          )
          yield* record(grant, asked.tool, noted, answer, asked.callKey, began, asked.arguments)
          return answer
        }).pipe(
          // A proposal recorded or refused: its values are masked as asked no longer.
          Effect.ensuring(
            asked.tool === 'setup_propose'
              ? SetupDesk.use((desk) => desk.passed(asked.arguments))
              : Effect.void,
          ),
        )

      /** 8. A call under a key: answered once, a retry given the same answer. */
      const keyed = (grant: Grant, asked: ToolCallAsked, key: string) =>
        Effect.gen(function* () {
          const kept = answeredKeys.get(grant.sessionId) ?? new Map<string, ToolAnswer>()
          const earlier = kept.get(key)
          if (earlier !== undefined) {
            kept.delete(key)
            kept.set(key, earlier)
            return earlier
          }
          const slot = `${grant.sessionId}\u0000${key}`
          const running = inFlight.get(slot)
          if (running !== undefined) return yield* Deferred.await(running)
          const reserved = Deferred.makeUnsafe<ToolAnswer>()
          inFlight.set(slot, reserved)
          const answer = yield* decided(grant, asked).pipe(
            Effect.onExit((exit) =>
              Effect.andThen(
                Effect.sync(() => inFlight.delete(slot)),
                Deferred.done(reserved, exit),
              ),
            ),
          )
          kept.set(key, answer)
          for (const oldest of kept.keys()) {
            if (kept.size <= KEYS_KEPT) break
            kept.delete(oldest)
          }
          answeredKeys.delete(grant.sessionId)
          answeredKeys.set(grant.sessionId, kept)
          for (const oldest of answeredKeys.keys()) {
            if (answeredKeys.size <= SESSIONS_KEPT) break
            answeredKeys.delete(oldest)
          }
          return answer
        })

      return {
        perform,
        call: (asked) =>
          Effect.gen(function* () {
            // 1. A live grant, of a session that exists.
            const grant = yield* ToolAccess.use((access) => access.byId(asked.grantId))
            if (grant === null) return refusal('refused: this session has ended')
            const exists = yield* getAgentSession(grant.sessionId).pipe(
              Effect.as(true),
              Effect.catchTag('UnknownAgentSession', () => Effect.succeed(false)),
              Effect.orElseSucceed(() => false),
            )
            if (!exists) return refusal('refused: this session no longer exists')
            // A session replaced, or holding an older epoch than its lineage's, acts no more.
            const current = yield* SessionEpochs.use((epochs) =>
              epochs.isCurrent(grant.sessionId, grant.epoch),
            )
            if (!current) return refusal('refused: this session has been replaced')
            const answer =
              asked.callKey === null
                ? yield* decided(grant, asked)
                : yield* keyed(grant, asked, asked.callKey)
            // What a tool answers (a file, a ticket, a command's output) never reads as Hemera's
            // own words: a marker or a note's tags in it are escaped before any note is added.
            const text = neutralised(answer.text)
            // What cannot wait for the end of the turn travels in this answer, once.
            const notes = yield* SessionNotes.use((pinned) => pinned.take(grant.sessionId))
            return { ...answer, text: notes.length === 0 ? text : [text, ...notes].join('\n\n') }
          }).pipe(Effect.provide(context)),
      }
    }),
  )
