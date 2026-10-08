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
 *  9. the execution, whose effects outside the database record their intent and outcome;
 * 10. the record of the call: session, role, mission, tool, class, verdict and who gave it,
 *     outcome, duration; its reason masked, never a file's content.
 *
 * Refusals are values, never thrown errors: the agent is told what was refused and why. The gate
 * never reads the agent's own permission mode: the verdict is the same whatever mode it stands on.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

import {
  ROLE_NAMES,
  ROLE_PLACES,
  ROOT_REPOSITORY,
  TOOLS,
  TOOL_NAMES,
  type ToolArguments,
  type ToolName,
  admitTool,
  lineFor,
} from '@hemera/core/domain'
import { formatSchemaError } from '@hemera/core/schema'
import type { Command } from '@hemera/ipc'
import { Context, Deferred, Effect, Layer, Option, Result, Schema } from 'effect'
import type { Scope } from 'effect'

import type { Log } from '../../main/diagnostic.ts'
import { getAgentSession } from '../agents/sessions.ts'
import { getCommand } from '../catalogue.ts'
import type { DomainEvents } from '../domain-events.ts'
import { getProject } from '../projects.ts'
import type { RunServices } from '../runs.ts'
import { Secrets } from '../secrets.ts'
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
import type { SpecBoard } from '../planning/board.ts'
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
import type { TesterFindings } from '../tester/findings.ts'
import { hemeraReport, hemeraReports } from '../tester/tools.ts'
import { resolvePath } from './paths.ts'
import {
  type CallSession,
  type FrozenCall,
  GateGuards,
  type JudgedCall,
  type JudgedPath,
  PermissionRequests,
  SensitivePlaces,
  SessionNotes,
  SetupDesk,
  Verdicts,
  outsideReason,
} from './ports.ts'

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
  | ProfileHome

/**
 * How many answered keys a session keeps against a retry, and how many sessions keep theirs, the
 * least recently asked let go of first: a retry comes seconds after the answer it lost.
 */
const KEYS_KEPT = 32
const SESSIONS_KEPT = 64

/** The longest reason a record keeps. */
const REASON_KEPT = 500

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
    case 'hemera_report':
      return decoder(tool, TOOLS.hemera_report.input)(raw)
    case 'hemera_reports':
      return decoder(tool, TOOLS.hemera_reports.input)(raw)
  }
}

/** The repository a call names, and the path its paths start from; a refusal when it has none. */
const baseOf = (grant: Grant, repository: string | undefined) =>
  Effect.gen(function* () {
    const root = grant.place.root
    if (repository === undefined) return Result.succeed(root)
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
      ) =>
        Effect.gen(function* () {
          const secrets = yield* Secrets
          const outcome = answer.ok ? 'done' : answer.refused ? 'refused' : 'failed'
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
          }
          const role = ROLE_NAMES[grant.role]
          // 2. The tool is one of the session's.
          const admission = admitTool(grant.role, grant.tools, tool)
          const name = TOOL_NAMES.find((one) => one === tool)
          if (!admission.admitted || name === undefined) {
            return refused(
              refusal(admission.admitted ? `refused: no tool ${tool}` : admission.reason),
            )
          }
          const entry = TOOLS[name]
          noted.gateClass = entry.gate
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
          for (const guard of yield* GateGuards) {
            const said = yield* guard({ session, tool: name, path })
            if (said !== null) return refused(refusal(said))
          }
          const judged: JudgedCall | null =
            entry.gate === 'workflow'
              ? null
              : {
                  session,
                  tool: name,
                  gate: entry.gate,
                  path,
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
          })
          return prepared
        })

      /** 9. The execution. */
      const execute = (grant: Grant, prepared: Prepared) =>
        Effect.gen(function* () {
          const { call, path } = prepared
          const fileCall = (resolved: JudgedPath): FileCall => ({
            sessionId: grant.sessionId,
            owner: ownerOf(grant),
            path: resolved.resolved,
            named: resolved.named,
            versions,
          })
          const pathOf = (): JudgedPath =>
            path ?? { named: '.', resolved: grant.place.root, inside: true, certain: true }
          switch (call.tool) {
            case 'fs_read': {
              const read = yield* fsRead(fileCall(pathOf()), call.args)
              return yield* uncommittedNoted(grant, pathOf().resolved, read)
            }
            case 'fs_list':
              return yield* fsList(fileCall(pathOf()), call.args)
            case 'search':
              return yield* search(fileCall(pathOf()), call.args)
            case 'fs_write':
              return yield* fsWrite(fileCall(pathOf()), call.args)
            case 'fs_edit':
              return yield* fsEdit(fileCall(pathOf()), call.args)
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
            case 'hemera_report':
              return yield* hemeraReport(grant, call.args)
            case 'hemera_reports':
              return yield* hemeraReports(call.args)
          }
        })

      /** Steps 2 to 7 and 9: the answer of one call, and what its record notes. */
      const decide = (grant: Grant, asked: ToolCallAsked, noted: Noted) =>
        Effect.gen(function* () {
          const prepared = yield* prepare(grant, asked.tool, asked.arguments, noted)
          if (Result.isFailure(prepared)) return prepared.failure
          const { session, path, judged } = prepared.success

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
          return yield* execute(grant, prepared.success)
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
            const changed = yield* holds(judged)
            if (changed !== null) return { kind: 'changed', reason: changed } satisfies Performed
            const answer = yield* execute(grant, prepared.success)
            return { kind: 'answered', answer } satisfies Performed
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
              ),
            ),
          )
          yield* record(grant, asked.tool, noted, answer, asked.callKey, began)
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
            // What cannot wait for the end of the turn travels in this answer, once.
            const notes = yield* SessionNotes.use((pinned) => pinned.take(grant.sessionId))
            return notes.length === 0
              ? answer
              : { ...answer, text: [answer.text, ...notes].join('\n\n') }
          }).pipe(Effect.provide(context)),
      }
    }),
  )
