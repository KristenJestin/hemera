/**
 * The Review page in its own words: the engine's reads of a mission in Review (its feedback and
 * rounds, the proofs, the final checks, the automatic review, the documenter, the services, the
 * diff, the pushes, the team's comments, Ship's preview and progress), turned into the values the
 * design system draws. Plain functions, no React and no Effect: the follower is `review-follow.ts`.
 * The page shows what the engine decides: whether Fix may be pressed and why Ship may not are the
 * engine's words, never worked out here.
 */

import { TO_A_MISSION, type Ball, type BlockedCause } from '@hemera/core/domain'
import type {
  AnchorView,
  AutoReviewView,
  BuildingView,
  Command,
  FeedbackView,
  ForgeRepositoryStatus,
  MissionDiff,
  MissionPushes,
  MissionService,
  Now,
  ProofsView,
  ReviewStateView,
  RoundDetailView,
  ShipPreview,
  ShipProgress,
  Spec,
  TeamCommentView,
  Wave,
} from '@hemera/ipc'
import type { MarkState, Review } from '@hemera/ui'
import { Match } from 'effect'

import { questionOf } from './planning-model.ts'

/** What the Review page is read from. */
export interface ReviewRead {
  /** The round the mission is at, as Now says it. */
  readonly round: number
  readonly state: ReviewStateView | null
  /** Each round's detail, once it was sent. */
  readonly details: ReadonlyArray<RoundDetailView>
  /** The mission's waves, the rounds' grilling among them. */
  readonly waves: ReadonlyArray<Wave>
  readonly spec: Spec | null
  readonly building: BuildingView | null
  readonly review: AutoReviewView | null
  readonly proofs: ProofsView | null
  readonly now: Now | null
  readonly services: ReadonlyArray<MissionService>
  readonly catalogue: ReadonlyArray<Command>
  readonly diff: MissionDiff | null
  readonly pushes: MissionPushes | null
  readonly team: ReadonlyArray<TeamCommentView>
  readonly preview: ShipPreview | null
  readonly progress: ShipProgress | null
  /** The forge of each repository of the Project, as the delivery rules detect it. */
  readonly forges: ReadonlyArray<ForgeRepositoryStatus>
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

const timeOf = (iso: string): string => TIME.format(new Date(iso))

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`

const tailOf = (output: string): string[] => output.split('\n').filter((one) => one.trim() !== '')

// --- The proofs -----------------------------------------------------------------------------

type ScenarioRead = ProofsView['scenarios'][number]

const scenarioOf = (spec: Spec | null, id: string) =>
  spec?.requirements.flatMap((one) => one.scenarios).find((one) => one.id === id)

/** What to do to verify a scenario by hand, from its Spec: the actions, then what is expected. */
function stepsOf(spec: Spec | null, id: string): string | undefined {
  const proof = scenarioOf(spec, id)?.proof
  if (proof === null || proof === undefined) return undefined
  return [...proof.actions, `Expected: ${proof.expected}`].join('. ')
}

/** A proof's state as its mark says it: a green off the current tree is to redo, never green. */
function proofStateOf(proof: ScenarioRead): Pick<Review.Proof, 'state' | 'redo'> {
  switch (proof.state) {
    case 'green':
      return proof.upToDate === false ? { state: 'red', redo: true } : { state: 'green' }
    case 'to_rerun':
      return { state: 'red', redo: true }
    case 'to_verify':
      return { state: 'toVerify' }
    case 'validated':
      return { state: proof.mode === 'by_hand' ? 'validated' : 'green' }
    case 'not_reproducible':
      return { state: 'green' }
    case 'refused':
      return { state: 'refused' }
    case 'waiting_red':
    case 'held':
    case 'red_recorded':
    case 'not_proven':
      return { state: 'red' }
  }
}

function proofsOf(read: ReviewRead): Review.Proof[] {
  return (read.proofs?.scenarios ?? []).map((proof) => {
    const { state, redo } = proofStateOf(proof)
    return {
      id: proof.scenario,
      requirement: proof.requirement,
      title: scenarioOf(read.spec, proof.scenario)?.then ?? proof.scenario,
      how: proof.mode === 'by_hand' ? 'hand' : 'test',
      state,
      redo,
      redAt: proof.red === null ? undefined : timeOf(proof.red.at),
      greenAt: proof.green === null ? undefined : timeOf(proof.green.at),
      steps: proof.mode === 'by_hand' ? stepsOf(read.spec, proof.scenario) : undefined,
      reason: proof.manual?.verdict === 'refused' ? (proof.manual.note ?? undefined) : undefined,
    }
  })
}

/** A final check's verdict as its mark: the engine keeps it as `green`, `red` or `skipped`. */
function verdictMarkOf(verdict: string): MarkState {
  if (verdict === 'green') return 'done'
  if (verdict === 'red') return 'failed'
  return 'skipped'
}

/** The final checks in full; one whose result is not on the current tree is to redo. */
function checksOf(read: ReviewRead): Review.Check[] {
  return (read.proofs?.finalChecks ?? []).map((check) => ({
    repository: check.place,
    name: check.name,
    state: verdictMarkOf(check.verdict),
    after: 'final',
    redo: check.upToDate ? undefined : true,
  }))
}

// --- The automatic review and the documenter ---------------------------------------------------

/** What the reviewers read: the checkpoint's files, in how many repositories, and when. */
function sawOf(review: AutoReviewView | null): string {
  const checkpoint = review?.checkpoint ?? null
  if (checkpoint === null) return ''
  const repositories = new Set(checkpoint.files.map((one) => one.repository)).size
  return `${plural(checkpoint.files.length, 'file', 'files')} in ${plural(repositories, 'repository', 'repositories')}, at ${timeOf(checkpoint.takenAt)}`
}

type FindingRead = AutoReviewView['findings'][number]

function fateOf(finding: FindingRead): string {
  switch (finding.fate) {
    case 'special_task':
      return finding.taskState === 'done'
        ? `fixed by ${finding.taskId ?? ''}`
        : `${finding.taskId ?? ''} works on it`
    case 'dismissed':
      return finding.evidence === null ? 'dismissed' : `dismissed: ${finding.evidence}`
    case 'recorded':
      return finding.answer === null ? 'recorded in the Spec' : `recorded: ${finding.answer}`
    case 'decision':
      return 'waits for your decision'
    case null:
      return 'not sorted yet'
  }
}

function findingsOf(review: AutoReviewView | null): Review.Finding[] {
  return (review?.findings ?? []).map((finding) => ({
    id: `A${String(finding.number)}`,
    severity: finding.severity,
    by: finding.reviewer === 'spec-reviewer' ? 'Spec reviewer' : 'Code reviewer',
    text: finding.text,
    fate: fateOf(finding),
  }))
}

/** What changed after the review, by who wrote it: each special task, then the documenter. */
function afterOf(read: ReviewRead): Review.AfterReview[] {
  const by = new Map<string, string[]>()
  for (const change of read.review?.changedAfter ?? []) {
    const writer = change.by ?? 'unknown'
    by.set(writer, [...(by.get(writer) ?? []), `${change.repository}/${change.path}`])
  }
  return [...by].map(([id, files]) => ({
    id,
    text:
      read.building?.tasks.find((one) => one.id === id)?.title ??
      (id === 'documenter' ? 'The documentation' : 'A change of unknown origin'),
    files,
  }))
}

const noDocChangeOf = (building: BuildingView | null): string | undefined =>
  building?.documenter.at(-1)?.noChangeReason ?? undefined

// --- The services and the changes -------------------------------------------------------------

const SERVICE_STATES = {
  starting: 'starting',
  ready: 'running',
  'not answering': 'running',
  stopped: 'stopped',
  failed: 'failed',
} as const satisfies Record<MissionService['state'], Review.Service['state']>

/** The mission's services, then the catalogue's never started: those cannot be removed. */
function servicesOf(read: ReviewRead): Review.Service[] {
  const lineOf = (service: MissionService): string =>
    read.catalogue.find((one) => one.id === service.commandId)?.line ?? service.name
  const listed = new Set(read.services.map((one) => one.commandId))
  return [
    ...read.services.map((one): Review.Service => {
      const state = SERVICE_STATES[one.state]
      const runs = state === 'running' || state === 'starting'
      return {
        name: one.name,
        state,
        url: one.url ?? undefined,
        line: lineOf(one),
        error: state === 'failed' ? tailOf(one.outputTail).at(-1) : undefined,
        removable: runs || one.dismissable ? undefined : false,
      }
    }),
    ...read.catalogue
      .filter((one) => one.type === 'serve' && one.scope === 'workspace' && !listed.has(one.id))
      .map((one): Review.Service => ({
        name: one.name,
        state: 'stopped',
        line: one.line,
        removable: false,
      })),
  ]
}

/** The changes per repository, from the live diff, with the files changed outside Hemera. */
function changesOf(diff: MissionDiff | null): Review.Change[] {
  return (diff?.repositories ?? [])
    .filter((one) => one.files.length > 0)
    .map((one) => {
      const outside = one.files
        .filter((file) => file.changedOutside !== null)
        .map((file) => `${one.repository}/${file.path}`)
      return {
        repository: one.repository,
        files: one.files.length,
        added: one.added,
        deleted: one.removed,
        outside: outside.length === 0 ? undefined : outside,
      }
    })
}

// --- The feedback and the rounds ------------------------------------------------------------

const REMARK_STATES = {
  waiting: 'waiting',
  in_round: 'inRound',
  addressed: 'addressed',
  resolved: 'resolved',
  withdrawn: 'withdrawn',
} as const satisfies Record<FeedbackView['state'], Review.RemarkState>

const sizeOf = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${String(Math.round(bytes / (1024 * 1024)))} MB`

/** Where a feedback was written: the Spec item, or the file and its first line. */
const anchorOf = Match.type<AnchorView>().pipe(
  Match.tagsExhaustive({
    Spec: (anchor) => anchor.item,
    Code: (anchor) => {
      const where = `${anchor.repository}/${anchor.path}`
      return anchor.lines === null ? where : `${where}:${String(anchor.lines.start)}`
    },
  }),
)

/**
 * Each feedback's name on screen, in the order it was written: `F1`, `F2`… The engine names a
 * feedback by an id the user never reads.
 */
export function feedbackLabels(feedback: ReadonlyArray<FeedbackView>): ReadonlyMap<string, string> {
  const ordered = [...feedback].sort((one, other) => one.createdAt.localeCompare(other.createdAt))
  return new Map(ordered.map((one, index) => [one.id, `F${String(index + 1)}`]))
}

function remarksOf(state: ReviewStateView | null): Review.Remark[] {
  const feedback = state?.feedback ?? []
  const labels = feedbackLabels(feedback)
  return [...feedback]
    .sort((one, other) => one.createdAt.localeCompare(other.createdAt))
    .map((one) => ({
      id: labels.get(one.id) ?? one.id,
      kind: one.kind === 'question' ? 'question' : 'remark',
      text: one.body,
      state: REMARK_STATES[one.state],
      anchor: one.anchor === null ? undefined : anchorOf(one.anchor),
      images: one.images.map((image) => ({ name: image.name, size: sizeOf(image.size) })),
      round: one.round,
      answer: one.answer ?? undefined,
      toMission: one.answer === TO_A_MISSION ? true : undefined,
      follows: one.followsUp === null ? undefined : labels.get(one.followsUp),
      at: timeOf(one.createdAt),
    }))
}

const ROUND_STATES = {
  grilling: 'grilling',
  building: 'building',
  answered: 'back',
  closed: 'closed',
} as const

type PointRead = RoundDetailView['points'][number]

const DELTA_WORDS = { added: 'Adds', modified: 'Changes', removed: 'Removes' } as const

/** A point's mark: done once the round is back, else as the tasks that carry it stand. */
function pointStateOf(detail: RoundDetailView, point: PointRead): MarkState {
  if (point.removed) return 'skipped'
  if (detail.state === 'answered' || detail.state === 'closed') return 'done'
  const tasks = detail.tasks.filter((one) => one.points.includes(point.id))
  if (tasks.length > 0 && tasks.every((one) => one.state === 'done')) return 'done'
  if (tasks.some((one) => one.state === 'failed')) return 'failed'
  if (tasks.some((one) => one.state !== null && one.state !== 'todo' && one.state !== 'waiting'))
    return 'running'
  return 'todo'
}

/** A point written like a requirement, its sources named as the page names them. */
function pointOf(
  detail: RoundDetailView,
  point: PointRead,
  labels: ReadonlyMap<string, string>,
): Review.RoundPoint {
  const clarified = point.decisions.find((one) => one.kind === 'clarify')
  const scenario = point.scenarios[0]
  return {
    id: point.id,
    title: point.text,
    kind: point.kind === 'behaviour' ? 'behaviour' : 'fix',
    sources: point.sources.map((one) => labels.get(one) ?? one),
    state: pointStateOf(detail, point),
    detail:
      point.removedReason ??
      (point.delta === null ? '' : `${DELTA_WORDS[point.delta.change]} ${point.delta.requirement}`),
    scenario: scenario === undefined ? undefined : `${scenario.id} · ${scenario.then}`,
    decision: point.decisions.find((one) => one.kind === 'behaviour')?.choice,
    conflict:
      clarified === undefined
        ? undefined
        : {
            with: point.delta?.requirement ?? '',
            why: clarified.why,
            outcome: 'clarified',
            note: clarified.choice,
          },
  }
}

/** The waves of a round's grilling: the mission's waves, only the questions this round asked. */
function wavesOf(read: ReviewRead, detail: RoundDetailView, now: Date): Review.Wave[] {
  const asked = new Set(detail.questions)
  return read.waves.flatMap((wave) => {
    const questions = wave.questions.filter((one) => asked.has(one.id))
    return questions.length === 0
      ? []
      : [{ n: wave.number, questions: questions.map((one) => questionOf(one, now)) }]
  })
}

/** The rounds sent, the latest first; the round still collecting is the feedback itself. */
function roundsOf(read: ReviewRead, now: Date): Review.Round[] {
  const labels = feedbackLabels(read.state?.feedback ?? [])
  return (read.state?.rounds ?? [])
    .flatMap((one) => {
      if (one.state === 'collecting') return []
      const detail = read.details.find((candidate) => candidate.number === one.number)
      return [
        {
          n: one.number,
          state: ROUND_STATES[one.state],
          waves: detail === undefined ? [] : wavesOf(read, detail, now),
          points:
            detail === undefined
              ? []
              : detail.points.map((point) => pointOf(detail, point, labels)),
          sentAt: timeOf(one.createdAt),
          backAt:
            one.state === 'answered' || one.state === 'closed' ? timeOf(one.movedAt) : undefined,
          building:
            one.state === 'building' && detail !== undefined
              ? `${String(detail.progress.done)} of ${plural(detail.progress.tasks, 'task', 'tasks')} done`
              : undefined,
        },
      ]
    })
    .sort((one, other) => other.n - one.n)
}

// --- The pull requests and the team's comments -----------------------------------------------

type PushRead = MissionPushes['repositories'][number]

const CI_MARKS = {
  passing: 'done',
  failing: 'failed',
  pending: 'running',
  none: undefined,
} as const satisfies Record<string, MarkState | undefined>

function pullStateOf(push: PushRead): Review.PullRequest['state'] {
  switch (push.state) {
    case 'waiting-for-click':
    case 'declined':
      return 'click'
    case 'running':
      return 'running'
    case 'waiting-for-cli':
      return 'signedOut'
    case 'failed':
    case 'indeterminate':
      return 'failed'
    case 'done':
      return push.pullRequest?.state === 'merged' ? 'merged' : 'open'
  }
}

/** Each repository's push and pull request as they stand; the CI is what Ship's preview read. */
function pullsOf(read: ReviewRead): Review.PullRequest[] {
  return (read.pushes?.repositories ?? []).map((push) => {
    const ci = read.preview?.repositories.find((one) => one.repository === push.repository)
      ?.pullRequest?.ci
    const fix = read.forges.find((one) => one.repositoryId === push.repositoryId)?.fix ?? null
    return {
      repository: push.repository,
      state: pullStateOf(push),
      number: push.pullRequest?.number,
      url: push.pullRequest?.url,
      ci: ci === undefined || ci === null ? undefined : CI_MARKS[ci],
      message: push.message ?? undefined,
      command:
        push.state === 'waiting-for-cli' && push.waitingFor !== null
          ? (fix ?? `${push.waitingFor} auth login`)
          : undefined,
      images:
        push.images.length === 0
          ? undefined
          : {
              published: push.images.some((one) => one.state === 'published'),
              names: push.images.map((one) => one.name),
            },
      step: push.state === 'running' ? (push.step ?? undefined) : undefined,
    }
  })
}

const forgeWordsOf = (forge: string): Review.ReviewMoment['forge'] => {
  if (forge === 'github') return 'GitHub'
  if (forge === 'bitbucket-cloud' || forge === 'bitbucket-datacenter') return 'Bitbucket'
  return null
}

/** The forge the pull requests go to: none with the Local preset, where Ship marks delivered. */
function forgeOf(read: ReviewRead): Review.ReviewMoment['forge'] {
  if (read.preview?.delivered !== null && read.preview?.delivered !== undefined) return null
  const named = [
    ...(read.pushes?.repositories ?? []).flatMap((one) =>
      one.pullRequest === null ? [] : [one.pullRequest.forge],
    ),
    ...read.team.map((one) => one.forge),
    ...read.forges.map((one) => one.forge),
  ]
  for (const forge of named) {
    const words = forgeWordsOf(forge)
    if (words !== null) return words
  }
  return null
}

const TEAM_STATES = {
  received: 'new',
  feedback: 'inRound',
  dismissed: 'dismissed',
} as const satisfies Record<TeamCommentView['state'], Review.TeamComment['state']>

/** The team's comments in the order they were written: the page names them `C1`, `C2`… */
export const teamInOrder = (team: ReadonlyArray<TeamCommentView>): TeamCommentView[] =>
  team.toSorted((one, other) => one.createdAt.localeCompare(other.createdAt))

function teamOf(team: ReadonlyArray<TeamCommentView>): Review.TeamComment[] {
  return teamInOrder(team).map((one, index) => ({
    id: `C${String(index + 1)}`,
    author: one.author,
    anchor:
      one.anchor === null
        ? 'the pull request'
        : `${one.anchor.repository}/${one.anchor.path}${one.anchor.lines === null ? '' : `:${String(one.anchor.lines.start)}`}`,
    text: one.body,
    reading: one.reading ?? '',
    draft: one.reply ?? '',
    state: TEAM_STATES[one.state],
    take: one.myTake ?? undefined,
    url: one.url ?? undefined,
    at: timeOf(one.createdAt),
  }))
}

// --- The page --------------------------------------------------------------------------------

const causeOf = Match.type<BlockedCause>().pipe(
  Match.tagsExhaustive({
    Dependency: (cause) => cause.missionKey,
    Resource: (cause) => `${cause.name} · ${cause.heldBy}`,
  }),
)

const ballOf = Match.type<Ball>().pipe(
  Match.tagsExhaustive({
    AgentWorking: (): Review.BallView => ({ ball: 'agent' }),
    WaitingOnYou: (): Review.BallView => ({ ball: 'you' }),
    WaitingOnSomeone: (): Review.BallView => ({ ball: 'someone' }),
    Blocked: (ball): Review.BallView => ({
      ball: 'someone',
      words: ball.causes.map(causeOf).join(', '),
    }),
    Idle: (): Review.BallView => ({ ball: 'you' }),
  }),
)

function faceOf(read: ReviewRead, refusals: readonly string[]): Review.ReviewMoment['face'] {
  const waiting = read.now?.waiting ?? []
  if (waiting.some((one) => one.kind === 'permission')) return 'permission'
  if (waiting.length > 0) return 'question'
  if (read.preview?.possible === true && refusals.length === 0) return 'done'
  return 'question'
}

function nowOf(read: ReviewRead): string {
  const now = read.now
  const doing = now?.doing.find((one) => one.main) ?? now?.doing[0]
  return (
    doing?.text ??
    now?.waiting[0]?.sentence ??
    (read.preview?.possible === true
      ? 'Nothing waits: Ship when you are satisfied.'
      : 'Review is yours: test the result, write your remarks, then Fix or Ship.')
  )
}

function progressOf(
  read: ReviewRead,
  remarks: readonly Review.Remark[],
): Review.ReviewMoment['progress'] {
  const step = read.round > 0 ? `Review · round ${String(read.round)}` : 'Review'
  const waiting = remarks.filter((one) => one.state === 'waiting').length
  const addressed = remarks.filter((one) => one.state === 'addressed').length
  const proofs = read.proofs?.scenarios ?? []
  const detail =
    waiting > 0
      ? `${plural(waiting, 'remark waits', 'remarks wait')} to be sent`
      : addressed > 0
        ? `${plural(addressed, 'addressed remark waits', 'addressed remarks wait')} for you`
        : `${String(proofs.filter((one) => one.state === 'green' || one.state === 'validated').length)} of ${String(proofs.length)} proofs green`
  return { step, detail }
}

const NO_PREVIEW: Review.ShipPreview = {
  leaving: [],
  outside: [],
  redo: [],
  unvalidated: [],
  rules: [],
  ci: [],
}

/** The Review page, from the engine's reads. */
export function reviewMomentOf(read: ReviewRead, now: Date): Review.ReviewMoment {
  const remarks = remarksOf(read.state)
  const refusals = read.preview?.reasons ?? []
  return {
    face: faceOf(read, refusals),
    now: nowOf(read),
    progress: progressOf(read, remarks),
    round: read.round,
    ball: read.now?.ball === null || read.now === null ? { ball: 'you' } : ballOf(read.now.ball),
    needs: [],
    remarks,
    fixable: read.state?.fixable ?? false,
    rounds: roundsOf(read, now),
    team: teamOf(read.team),
    pulls: pullsOf(read),
    forge: forgeOf(read),
    services: servicesOf(read),
    proofs: proofsOf(read),
    checks: checksOf(read),
    findings: findingsOf(read.review),
    saw: sawOf(read.review),
    after: afterOf(read),
    noDocChange: noDocChangeOf(read.building),
    changes: changesOf(read.diff),
    refusals,
    preview: NO_PREVIEW,
  }
}
