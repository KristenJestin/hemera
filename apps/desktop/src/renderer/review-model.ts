/**
 * The Review page in its own words: the engine's reads of a mission in Review (its feedback and
 * rounds, the proofs, the final checks, the automatic review, the documenter, the services, the
 * diff, the pushes, the team's comments, Ship's preview and progress), turned into the values the
 * design system draws. Plain functions, no React and no Effect: the follower is `review-follow.ts`.
 * The page shows what the engine decides: whether Fix may be pressed and why Ship may not are the
 * engine's words, never worked out here.
 */

import type { Ball, BlockedCause } from '@hemera/core/domain'
import type {
  AnchorView,
  AutoReviewView,
  BuildingView,
  Command,
  FeedbackView,
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

/** The rounds sent, the latest first; the round still collecting is the feedback itself. */
function roundsOf(state: ReviewStateView | null): Review.Round[] {
  return (state?.rounds ?? [])
    .flatMap((one) =>
      one.state === 'collecting'
        ? []
        : [
            {
              n: one.number,
              state: ROUND_STATES[one.state],
              waves: [],
              points: [],
              sentAt: timeOf(one.createdAt),
              backAt:
                one.state === 'answered' || one.state === 'closed'
                  ? timeOf(one.movedAt)
                  : undefined,
            },
          ],
    )
    .sort((one, other) => other.n - one.n)
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
export function reviewMomentOf(read: ReviewRead, _now: Date): Review.ReviewMoment {
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
    rounds: roundsOf(read.state),
    team: [],
    pulls: [],
    forge: null,
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
