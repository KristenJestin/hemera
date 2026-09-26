/**
 * A build as the window reads it, the Project's checks as its settings edit them, and the use
 * cases that carry both (design D10-04 to D10-12).
 *
 * Zod mirrors of the domain's closed sets in `packages/core/src/domain/build.ts`, field for field
 * and with the same names; every time here is an ISO string, as the engine writes it. The domain
 * does not depend on `ipc` and `ipc` does not depend on the domain; the engine is the one program
 * that sees both.
 */

import { z } from 'zod'

/** Where a build stands (D10-01): its three phases, then accepted or stopped. */
export const buildPhaseSchema = z.enum(['prepare', 'execute', 'verify', 'accepted', 'stopped'])

export type BuildPhase = z.infer<typeof buildPhaseSchema>

/** Where a contractual task stands in a build (D10-04). */
export const buildTaskStateSchema = z.enum([
  'waiting',
  'ready',
  'in_progress',
  'checking',
  'done',
  'yours',
  'blocked',
  'skipped',
])

export type BuildTaskState = z.infer<typeof buildTaskStateSchema>

/** What an attempt is about (D10-07): one task, the checks of a story, or the end checks. */
export const attemptScopeSchema = z.enum(['task', 'story', 'build'])

/** How an attempt ended; null while it runs (D10-07). */
export const attemptResultSchema = z.enum(['green', 'red', 'unverified'])

/** What one check's run says (D10-06). */
export const checkVerdictSchema = z.enum(['green', 'red', 'skipped'])

/** Where a check runs (D10-06): the Workspace root, one repository, each changed repository. */
export const checkWhereSchema = z.enum(['root', 'repository', 'changed'])

/** When a check runs (D10-06): after each task, after each story, or at the end. */
export const checkWhenSchema = z.enum(['task', 'story', 'end'])

/** One check as it ran under an attempt, and Hemera's verdict on it (D10-06). */
export const checkResultViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Where it ran: `''` for the Workspace root, or the repository's path. */
  place: z.string(),
  /** The line as it ran, `{files}` expanded. */
  line: z.string(),
  verdict: checkVerdictSchema,
  exitCode: z.number().nullable(),
  value: z.number().nullable(),
  /** Why it is red or skipped, in plain words (`64.2 < 70`); null when green. */
  detail: z.string().nullable(),
  outputTail: z.string(),
  /** The run of the Commands service it was; null for a check skipped without running. */
  runId: z.string().nullable(),
  ranAt: z.string(),
})

export type CheckResultView = z.infer<typeof checkResultViewSchema>

/** One file an attempt changed, in one repository (D10-05). */
export const attemptFileSchema = z.object({
  /** The repository's path under the Workspace, `''` for a repository at its root. */
  repository: z.string(),
  path: z.string(),
  status: z.string(),
  /** Lines added and removed; null for a binary file. */
  added: z.number().nullable(),
  removed: z.number().nullable(),
})

/** One attempt of a task, of a story or of the build, with its evidence (D10-05, D10-07). */
export const attemptViewSchema = z.object({
  id: z.string(),
  scope: attemptScopeSchema,
  /** Counted from one, per task, per story and per build. */
  number: z.number(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  result: attemptResultSchema.nullable(),
  checks: z.readonly(z.array(checkResultViewSchema)),
  files: z.readonly(z.array(attemptFileSchema)),
})

export type AttemptView = z.infer<typeof attemptViewSchema>

/**
 * One contractual task of the build (D10-04): `id` is the build task's own, which the actions
 * are sent with, and `taskId` the Spec's task it builds; `dependsOn` names its dependencies by
 * label. `skipUnblocks` says whether a skip let its dependants go on (D10-03).
 */
export const buildTaskViewSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  label: z.string(),
  title: z.string(),
  result: z.string(),
  criteria: z.string(),
  type: z.string(),
  executor: z.enum(['agent', 'human']),
  state: buildTaskStateSchema,
  dependsOn: z.readonly(z.array(z.string())),
  storyIds: z.readonly(z.array(z.string())),
  handedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  updatedAt: z.string(),
  skipReason: z.string().nullable(),
  skipUnblocks: z.boolean(),
  attempts: z.readonly(z.array(attemptViewSchema)),
})

export type BuildTaskView = z.infer<typeof buildTaskViewSchema>

/** The agent saying a task contradicts the Spec (D10-08); `taskId` is the build task's id. */
export const blockerViewSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  label: z.string(),
  reason: z.string(),
  raisedAt: z.string(),
  dismissedAt: z.string().nullable(),
})

export type BlockerView = z.infer<typeof blockerViewSchema>

/** A story of the revision, its state derived from the evidence of its tasks (D10-07). */
export const storyViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** The labels of the tasks that cover it. */
  labels: z.readonly(z.array(z.string())),
  state: z.enum(['open', 'checking', 'green', 'red']),
  attempts: z.readonly(z.array(attemptViewSchema)),
})

export type StoryView = z.infer<typeof storyViewSchema>

/**
 * A `build` Session's build, as `build.read` answers it and every build action answers the build
 * it leaves (D10-12). `revision` is the number of the revision the build was started on, which
 * "Spec" opens read only; `detail` says why it stopped; `note` is the agent's approach (D10-02);
 * `canAccept` is true once `verify` is green and nothing waits for the user (D10-11).
 */
export const buildViewSchema = z.object({
  sessionId: z.string(),
  specId: z.string(),
  specKey: z.string(),
  specTitle: z.string(),
  revision: z.number(),
  phase: buildPhaseSchema,
  pausedAt: z.string().nullable(),
  detail: z.string().nullable(),
  note: z.string().nullable(),
  tasks: z.readonly(z.array(buildTaskViewSchema)),
  blockers: z.readonly(z.array(blockerViewSchema)),
  stories: z.readonly(z.array(storyViewSchema)),
  endAttempts: z.readonly(z.array(attemptViewSchema)),
  canAccept: z.boolean(),
})

export type BuildView = z.infer<typeof buildViewSchema>

/**
 * What a check is before the Project keeps it (D10-06): what the check dialog edits and what the
 * catalogue proposes. A catalogue command by id or a line, exactly one of the two; `repository` is
 * set only when `where` is `repository`; `expect` is green only on exit code 0 and a number at least its minimum.
 */
export const checkDraftSchema = z.object({
  name: z.string(),
  commandId: z.string().nullable(),
  line: z.string().nullable(),
  where: checkWhereSchema,
  repository: z.string().nullable(),
  when: checkWhenSchema,
  expect: z.object({ pattern: z.string(), minimum: z.number() }).nullable(),
  files: z.string().nullable(),
})

export type CheckDraft = z.infer<typeof checkDraftSchema>

/** One check of a Project, ordered by `rank` (D10-06). */
export const projectCheckSchema = checkDraftSchema.extend({
  id: z.string(),
  projectId: z.string(),
  rank: z.string(),
})

export type ProjectCheck = z.infer<typeof projectCheckSchema>

/** Which build an action is about. */
const buildSchema = z.object({ sessionId: z.string() })

/**
 * The build and check use cases of the process that holds the database, spread into
 * `ENGINE_REQUESTS`.
 *
 * The window never sets a task's state: it says the user's Done, Skip, dismissal, pause, resume,
 * accept and stop, and the engine decides what follows (D10-04). Every build action answers the
 * build it leaves.
 */
export const BUILD_REQUESTS = {
  'build.read': { arguments: buildSchema, response: buildViewSchema },
  'build.pause': { arguments: buildSchema, response: buildViewSchema },
  'build.resume': { arguments: buildSchema, response: buildViewSchema },
  'build.accept': { arguments: buildSchema, response: buildViewSchema },
  'build.stop': { arguments: buildSchema, response: buildViewSchema },
  // A task that is the user's, done by them or skipped with a reason; `unblock` lets its
  // dependants go on as if it were done (D10-08). `taskId` is the build task's id.
  'build.taskDone': {
    arguments: buildSchema.extend({ taskId: z.string() }),
    response: buildViewSchema,
  },
  'build.taskSkip': {
    arguments: buildSchema.extend({
      taskId: z.string(),
      reason: z.string(),
      unblock: z.boolean(),
    }),
    response: buildViewSchema,
  },
  // The blocker put aside: its task is ready again, with what the user wrote beside it
  // (D10-08, issue #117).
  'build.dismissBlocker': {
    arguments: buildSchema.extend({ blockerId: z.string(), note: z.string().nullable() }),
    response: buildViewSchema,
  },

  // The Build section of the Project settings (D10-06): the checks, and while there are none the
  // checks proposed from the catalogue, never saved by being proposed. `save` writes a new check
  // when `id` is null and rewrites the one it names otherwise; `acceptProposed` saves the drafts
  // the user kept, edited or not, all at once.
  'checks.list': {
    arguments: z.object({ projectId: z.string() }),
    response: z.object({
      checks: z.array(projectCheckSchema),
      proposed: z.array(checkDraftSchema),
    }),
  },
  'checks.save': {
    arguments: z.object({
      projectId: z.string(),
      id: z.string().nullable(),
      draft: checkDraftSchema,
    }),
    response: projectCheckSchema,
  },
  'checks.remove': {
    arguments: z.object({ id: z.string() }),
    response: z.void(),
  },
  'checks.acceptProposed': {
    arguments: z.object({ projectId: z.string(), drafts: z.array(checkDraftSchema) }),
    response: z.array(projectCheckSchema),
  },
} as const
