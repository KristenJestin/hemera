/**
 * The Ready and Building pages in their own words: the engine's read models of the pre-launch
 * check, the launch, the Building, its tasks, its services and helpers, and the mission's own
 * things (dependencies, grants, budget), turned into the values the design system draws. Plain
 * functions, no React and no Effect: the followers that read the engine are `building-follow.ts`.
 */

import { REVIEWER_NAMES, type ModelSettingValue } from '@hemera/core/domain'
import type {
  AgentState,
  AttemptCheckView,
  AutoReviewView,
  BuildingAttemptView,
  BuildingPreparation,
  BuildingTaskView,
  BuildingView,
  CheckModel,
  Command,
  HelperChip,
  JournalLine,
  MissionBudget,
  MissionDependencies,
  MissionDiff,
  MissionGrant,
  MissionService,
  ModelMark,
  MovedItem,
  Now,
  PrelaunchView,
  Spec,
} from '@hemera/ipc'
import { EFFORTS, type Building, type MarkState, type ModelChoice } from '@hemera/ui'
import { Predicate } from 'effect'

import { OWN_DEFAULT, pickerAgentsOf } from './chat-items.ts'
import { stageOf } from './missions.ts'

/** What the mission's own things are read from, on every stage. */
export interface MissionRead {
  readonly dependencies: MissionDependencies | null
  /** The title of each mission of the Project, by its key. */
  readonly titles: ReadonlyMap<string, string>
  readonly grants: ReadonlyArray<MissionGrant>
  readonly budget: MissionBudget | null
}

/** What the Ready page is read from. */
export interface ReadyRead {
  readonly spec: Spec
  /** When the Spec was frozen, from the mission's last Freeze. */
  readonly frozenAt: string | null
  /** The mission's last check, as the engine keeps it. */
  readonly check: PrelaunchView | null
  /** A check is asked and the engine has not answered yet. */
  readonly checking: boolean
  /** The launch was refused: something moved since the check. */
  readonly expired: boolean
  readonly preparation: BuildingPreparation | null
  /** The Builder's model as the engine last said it: the last check's, or the last choice's. */
  readonly model: CheckModel | null
  readonly agents: ReadonlyArray<AgentState>
  readonly marks: ReadonlyArray<ModelMark>
  readonly things: MissionRead
}

/** What the Building page is read from. */
export interface BuildingRead {
  readonly building: BuildingView
  readonly spec: Spec | null
  readonly now: Now | null
  /** The journal's lines read so far, newest first. */
  readonly journal: ReadonlyArray<JournalLine>
  /** Whether it goes further back than what was read. */
  readonly journalMore: boolean
  readonly services: ReadonlyArray<MissionService>
  /** The Project's catalogue: the services the mission may start from it. */
  readonly catalogue: ReadonlyArray<Command>
  readonly helpers: ReadonlyArray<HelperChip>
  readonly review: AutoReviewView | null
  readonly diff: MissionDiff | null
  /** The Workspace's name, once read. */
  readonly workspace: string | null
  readonly things: MissionRead
}

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

const sameDay = (one: Date, other: Date): boolean =>
  one.getFullYear() === other.getFullYear() &&
  one.getMonth() === other.getMonth() &&
  one.getDate() === other.getDate()

/** A moment as a line says it: `today at 09:31`, `yesterday at 17:02`, `9 Oct at 11:20`. */
export function momentOf(iso: string, now: Date): string {
  const moment = new Date(iso)
  const time = TIME.format(moment)
  if (sameDay(moment, now)) return `today at ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(moment, yesterday)) return `yesterday at ${time}`
  return `${DAY.format(moment)} at ${time}`
}

/** The time of a moment of today, or the moment in full on another day. */
const timeOf = (iso: string, now: Date): string =>
  sameDay(new Date(iso), now) ? TIME.format(new Date(iso)) : momentOf(iso, now)

const MINUTE = 60

/** A length of time in minutes, then hours: `11 min`, `1 h 56 min`. */
export function durationOf(seconds: number): string {
  const minutes = Math.floor(seconds / MINUTE)
  if (minutes < 60) return `${String(minutes)} min`
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`
}

const secondsBetween = (from: string, to: string): number =>
  Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000)

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`

// --- The mission's own things -------------------------------------------------------------

/** The dependencies the mission has: those accepted, each with its stage. */
function dependenciesOf(read: MissionRead): Building.Dependency[] {
  return (read.dependencies?.dependsOn ?? [])
    .filter((one) => one.state === 'accepted')
    .map((one) => ({
      key: one.dependsOnKey,
      title: read.titles.get(one.dependsOnKey) ?? one.dependsOnKey,
      stage: stageOf(one.dependsOnStage),
    }))
}

/** What the window names a counter by: never the engine's `attempts`. */
const COUNTER_WORDS = {
  launches: ['launch', 'launches'],
  attempts: ['try', 'tries'],
  rounds: ['round', 'rounds'],
} as const

const CURRENCY_SIGNS = new Map([
  ['USD', '$'],
  ['EUR', '€'],
  ['GBP', '£'],
])

/** A cost in its currency: `$12.40`, or `12.40 CHF` for a currency without a sign here. */
const costOf = (cost: { readonly amount: number; readonly currency: string }): string => {
  const sign = CURRENCY_SIGNS.get(cost.currency)
  const amount = cost.amount.toFixed(2)
  return sign === undefined ? `${amount} ${cost.currency}` : `${sign}${amount}`
}

const tokensOf = (count: number): string =>
  count >= 1_000_000
    ? `${(count / 1_000_000).toFixed(1)} M tokens`
    : count >= 1000
      ? `${String(Math.round(count / 1000))} k tokens`
      : plural(count, 'token', 'tokens')

/** The budget's line: the limit nearest its end; its fold, every limit and the usage. */
export function budgetOf(budget: MissionBudget | null): Building.Budget {
  const counters = budget?.counters ?? []
  const shareOf = (one: (typeof counters)[number]): number =>
    one.limit === 0 ? (one.spent > 0 ? 1 : 0) : one.spent / one.limit
  const nearest = counters.reduce<(typeof counters)[number] | undefined>(
    (best, one) => (best === undefined || shareOf(one) > shareOf(best) ? one : best),
    undefined,
  )
  const nounOf = (one: (typeof counters)[number]): string => {
    const [singular, many] = COUNTER_WORDS[one.counter]
    return one.limit === 1 ? singular : many
  }
  const usage = budget?.usage ?? null
  const cost = usage?.cost ?? null
  const used =
    usage === null
      ? undefined
      : [
          ...(cost === null ? [] : [costOf(cost)]),
          tokensOf(usage.inputTokens + usage.outputTokens),
        ].join(' · ')
  const shown: Building.Budget =
    nearest === undefined
      ? { cap: null, spent: 'Nothing used', share: null, estimated: false }
      : {
          cap: `${String(nearest.limit)} ${nounOf(nearest)}`,
          spent: String(nearest.spent),
          share: shareOf(nearest),
          limits: counters.map(
            (one) => `${String(one.spent)} of ${String(one.limit)} ${nounOf(one)}`,
          ),
          estimated: false,
        }
  return used === undefined || usage === null
    ? shown
    : { ...shown, usage: used, estimated: !usage.measured }
}

/** The mission's dependencies, what was allowed for it and still holds, and its budget. */
export function missionThingsOf(read: MissionRead, now: Date): Building.MissionThings {
  return {
    dependencies: dependenciesOf(read),
    grants: read.grants
      .filter((one) => one.state === 'live')
      .map((one) => ({
        id: one.id,
        action: one.action,
        by: one.givenBy === 'user' ? 'You' : one.givenBy,
        at: momentOf(one.givenAt, now),
        uses: one.uses,
      })),
    budget: budgetOf(read.budget),
  }
}

// --- The Ready page ------------------------------------------------------------------------

/** The order #149 lists what moved in; what the agent was handed comes after. */
const MOVED_ORDER: ReadonlyArray<MovedItem['kind']> = [
  'target',
  'proof',
  'requirement',
  'relied',
  'ticket',
  'dirty',
]

const MOVED_KINDS: Readonly<Record<MovedItem['kind'], Building.Moved['kind'] | null>> = {
  target: 'target',
  proof: 'proof',
  requirement: 'living',
  relied: 'living',
  ticket: 'ticket',
  dirty: 'dirty',
  // A file the agent says matters is its handed file, with its verdict: not listed twice.
  agent: null,
}

/** What the check found moved, in #149's order, then each file handed with its verdict. */
function movedOf(check: PrelaunchView): Building.Moved[] {
  const found = MOVED_ORDER.flatMap((kind) =>
    check.moved
      .filter((one) => one.kind === kind)
      .flatMap((one): Building.Moved[] => {
        const shown = MOVED_KINDS[one.kind]
        if (shown === null) return []
        const file =
          one.repository !== null && one.path !== null ? `${one.repository}/${one.path}` : one.path
        const how =
          one.added !== null && one.removed !== null
            ? `+${String(one.added)} −${String(one.removed)}`
            : one.said
        return [{ kind: shown, what: file ?? one.said, how }]
      }),
  )
  const handed = check.handed.map((one): Building.Moved => {
    const base: Building.Moved = {
      kind: 'other',
      what: `${one.repository}/${one.path}`,
      how: 'Changed on the base since the Freeze',
    }
    if (one.answer !== null) base.verdict = { holds: !one.answer.matters, why: one.answer.why }
    return base
  })
  return [...found, ...handed]
}

/** The words of a check's step under way: the one running, or the last that ended. */
const stepOf = (check: PrelaunchView): string =>
  check.steps.find((one) => one.state === 'running')?.said ??
  check.steps.at(-1)?.said ??
  'Starts the check'

/** Where the pre-launch check stands, as the Ready card says it. */
export function launchCheckOf(
  read: Pick<ReadyRead, 'check' | 'checking' | 'expired' | 'things'>,
  now: Date,
): Building.LaunchCheck {
  const { check } = read
  if (read.expired) return { state: 'expired' }
  if (read.checking && check?.state !== 'running') {
    return { state: 'checking', step: 'Starts the check' }
  }
  if (check === null) return { state: 'idle' }
  if (check.state === 'running') return { state: 'checking', step: stepOf(check) }
  if (check.state === 'failed') {
    return {
      state: 'failed',
      reason: check.steps.find((one) => one.state === 'failed')?.said ?? check.verdict.said,
    }
  }
  const [blocker] = check.verdict.blockedBy
  if (blocker !== undefined) {
    const seen = check.dependencies.find((one) => one.key === blocker)
    return {
      state: 'dependency',
      dependency: {
        key: blocker,
        title: read.things.titles.get(blocker) ?? blocker,
        stage: stageOf(seen?.stage ?? 'planning'),
      },
    }
  }
  const moved = movedOf(check)
  if (check.verdict.outdated) return { state: 'outdated', moved }
  const [unfetched] = check.bases.flatMap((one) =>
    Predicate.isTagged(one.freshness, 'NotFetchedSince') ? [one.freshness] : [],
  )
  if (unfetched !== undefined) {
    const since = unfetched.since
    return { state: 'unfetched', since: since === null ? 'ever' : momentOf(since, now), moved }
  }
  if (check.agent.state === 'unanswered' || check.agent.state === 'failed') {
    return { state: 'silent', moved }
  }
  return moved.length > 0 ? { state: 'moved', moved } : { state: 'clear' }
}

/** A setting as the model picker holds it: the agent's own default is no model named. */
const choiceOf = (setting: {
  readonly agent: string
  readonly model: string | null
  readonly effort: string | null
}): ModelChoice => {
  const effort = EFFORTS.find((one) => one === setting.effort)
  const choice: ModelChoice = { agent: setting.agent, model: setting.model ?? OWN_DEFAULT }
  return effort === undefined ? choice : { ...choice, effort }
}

const wordsOfModel = (model: string, effort: string | null): string =>
  effort === null ? model : `${model} · ${effort}`

/** The Builder's model: the mission's own choice or what it inherits, and the Planner's advice. */
function builderModelOf(read: ReadyRead): Building.BuilderModel {
  const advice = read.spec.recommendation
  const own = read.model?.level === 'mission' ? read.model.setting : null
  const inherited: ModelSettingValue | null =
    read.model !== null && read.model.level !== 'mission'
      ? read.model.setting
      : advice === null
        ? null
        : { agent: advice.agent, model: advice.model, effort: advice.effort }
  const shown: Building.BuilderModel = {
    agents: pickerAgentsOf(
      read.agents,
      read.marks,
      own ?? inherited ?? { agent: 'claude', model: null, effort: null },
    ),
    value: own === null ? null : choiceOf(own),
  }
  const withFallback = inherited === null ? shown : { ...shown, fallback: choiceOf(inherited) }
  return advice === null
    ? withFallback
    : {
        ...withFallback,
        recommended: { words: wordsOfModel(advice.model, advice.effort), why: advice.reason },
      }
}

const STEP_MARKS = {
  pending: 'todo',
  running: 'running',
  done: 'done',
  skipped: 'done',
  failed: 'failed',
} as const satisfies Record<BuildingPreparation['steps'][number]['state'], MarkState>

const STEP_VERBS = { worktree: 'Worktree', copy: 'Copy', link: 'Link', run: 'Run' } as const

/** The preparation's steps: what each does, where, and where it stands. */
function preparationOf(preparation: BuildingPreparation): Building.PreparationStep[] {
  return preparation.steps.map((step) => {
    const name =
      step.kind === 'worktree'
        ? [STEP_VERBS.worktree, step.base].filter((part) => part !== null).join(' ')
        : `${STEP_VERBS[step.kind]} ${step.line ?? step.path ?? ''}`.trim()
    const state = STEP_MARKS[step.state]
    const detail =
      step.failure !== null
        ? `${step.failure.doing} failed`
        : step.kind === 'worktree'
          ? null
          : step.base
    return detail === null ? { name, state } : { name, state, detail }
  })
}

/** The Ready page: the frozen Spec in summary, the check, the model, the preparation. */
export function readyMomentOf(read: ReadyRead, now: Date): Building.ReadyMoment {
  const { spec } = read
  return {
    goal: spec.sections.find((section) => section.name === 'why')?.body ?? '',
    requirements: spec.requirements
      .filter((one) => !one.removed)
      .map((one) => ({ id: one.id, title: one.text, scenarios: one.scenarios.length })),
    frozenAt: read.frozenAt === null ? 'before' : momentOf(read.frozenAt, now),
    model: builderModelOf(read),
    check: launchCheckOf(read, now),
    preparation: read.preparation === null ? null : preparationOf(read.preparation),
    needs: [],
    mission: missionThingsOf(read.things, now),
  }
}

// --- The Building page ---------------------------------------------------------------------

/** The Spec's tasks, the special ones apart: those of the automatic review. */
const specTasksOf = (building: BuildingView): BuildingTaskView[] =>
  building.tasks.filter((one) => one.origin !== 'review')

/**
 * Building's percentage (open question 24): the Spec's tasks done and verified, of those not
 * skipped. A task done but not verified may still go back, and a figure that falls back reads as
 * a lie; the special tasks are counted apart.
 */
export function percentOf(building: BuildingView): number {
  const counted = specTasksOf(building).filter((one) => one.state !== 'skipped')
  const verified = counted.filter((one) => one.state === 'done' && one.verified === true).length
  return counted.length === 0 ? 0 : Math.floor((verified / counted.length) * 100)
}

/** Whether a decision of the user holds the task: it waits for them rather than for a cause. */
const waitsForYou = (building: BuildingView, id: string): boolean =>
  building.decisions.some((one) => one.tasks.includes(id) && one.answeredAt === null)

function taskStateOf(building: BuildingView, one: BuildingTaskView): Building.TaskState {
  switch (one.state) {
    case 'done':
      return one.verified === true ? 'verified' : 'unverified'
    case 'in_progress':
    case 'checking':
      return 'running'
    case 'blocked':
      return waitsForYou(building, one.id) ? 'waiting' : 'blocked'
    case 'skipped':
      return 'skipped'
    case 'available':
    case 'waiting':
      return 'todo'
  }
}

/** A task's row: its mark, its title, its repositories, its failed tries and why it is blocked. */
function taskOf(building: BuildingView, one: BuildingTaskView): Building.Task {
  const state = taskStateOf(building, one)
  const failures = one.attempts.filter((attempt) => attempt.verdict === 'red').length
  const shown: Building.Task = {
    id: one.id,
    title: one.title,
    state,
    repositories: [...new Set(one.targets.map((target) => target.repository))],
  }
  if (failures > 0) shown.failures = failures
  if (state === 'blocked' && one.blockedBy !== null) shown.cause = one.blockedBy
  return shown
}

type ProofView = BuildingView['requirements'][number]['scenarios'][number]

/** A scenario's proof as its marks say it: never green when its green is not up to date. */
function proofStateOf(proof: ProofView): Building.ProofState {
  switch (proof.state) {
    case 'waiting_red':
    case 'held':
      return 'none'
    case 'red_recorded':
    case 'not_proven':
    case 'refused':
      return 'red'
    case 'green':
      return proof.upToDate === false ? 'rerun' : 'green'
    case 'to_rerun':
      return 'rerun'
    case 'to_verify':
      return 'manual'
    case 'validated':
    case 'not_reproducible':
      return 'green'
  }
}

const textOf = (spec: Spec | null, id: string): string =>
  spec?.requirements.find((one) => one.id === id)?.text ?? id

const scenarioTitleOf = (spec: Spec | null, id: string): string =>
  spec?.requirements.flatMap((one) => one.scenarios).find((one) => one.id === id)?.then ?? id

function requirementsOf(read: BuildingRead, now: Date): Building.Requirement[] {
  const { building, spec } = read
  const tasks = specTasksOf(building)
  return building.requirements.map((requirement) => ({
    id: requirement.id,
    title: textOf(spec, requirement.id),
    tasks: requirement.tasks.flatMap((id) => {
      const one = tasks.find((candidate) => candidate.id === id)
      return one === undefined ? [] : [taskOf(building, one)]
    }),
    scenarios: requirement.scenarios.map((proof) => {
      const shown: Building.Scenario = {
        id: proof.scenario,
        title: scenarioTitleOf(spec, proof.scenario),
        proof: proofStateOf(proof),
      }
      if (proof.red !== null) shown.redAt = timeOf(proof.red.at, now)
      return shown
    }),
  }))
}

/** The phases of a Building in their order, and the engine's phases each one covers. */
const PHASES = [
  { id: 'tasks', title: 'Tasks', covers: ['tasks'] },
  { id: 'documentation', title: 'Documentation', covers: ['documenter'] },
  { id: 'final-checks', title: 'Final checks', covers: ['final_checks', 'checkpoint'] },
  { id: 'review', title: 'Automatic review', covers: ['review'] },
  { id: 'special', title: 'Special tasks', covers: ['special_tasks', 'documenter_delta'] },
] as const satisfies ReadonlyArray<{ id: Building.Phase['id']; title: string; covers: string[] }>

function phasesOf(read: BuildingRead): Building.Phase[] {
  const { building, review } = read
  const current = PHASES.findIndex((one) =>
    one.covers.some((phase: string) => phase === building.phase),
  )
  // Once refreshed or ended, every phase is behind.
  const at = building.state === 'active' && current >= 0 ? current : PHASES.length
  return PHASES.map((one, index): Building.Phase => {
    const state: MarkState = index < at ? 'done' : index === at ? 'running' : 'todo'
    const shown: Building.Phase = { id: one.id, title: one.title, state }
    if (state !== 'running') return shown
    if (one.id === 'review' && review !== null && review.passes.length > 0) {
      const done = review.passes.filter((pass) => pass.state === 'done' || pass.state === 'failed')
      shown.detail = `${String(done.length)} of ${String(review.passes.length)} done`
      return shown
    }
    if (one.id === 'special' && building.special.total > 0) {
      shown.detail = `${String(building.special.done)} of ${String(building.special.total)} done`
      return shown
    }
    return shown
  })
}

const CHECK_MARKS = {
  green: 'done',
  red: 'failed',
  skipped: 'skipped',
} as const satisfies Record<AttemptCheckView['verdict'], MarkState>

const tailOf = (output: string): string[] => output.split('\n').filter((one) => one.trim() !== '')

/**
 * The checks per repository: each one's latest result, after the requirement it ran on, quiet
 * while it passes and standing out red; the final ones apart, in full.
 */
function checksOf(building: BuildingView): Building.Check[] {
  const latest = new Map<string, { check: AttemptCheckView; after: string }>()
  for (const attempt of building.scopes) {
    if (attempt.scope !== 'requirement' && attempt.scope !== 'end') continue
    for (const check of attempt.checks) {
      const final = check.shown === 'final'
      const key = `${final ? 'final' : 'quiet'} ${check.place} ${check.name}`
      const known = latest.get(key)
      if (known !== undefined && Date.parse(known.check.at) > Date.parse(check.at)) continue
      const after = final || attempt.subject === null ? 'final' : `after ${attempt.subject}`
      latest.set(key, { check, after })
    }
  }
  return [...latest.values()].map(({ check, after }) => {
    const shown: Building.Check = {
      repository: check.place,
      name: check.name,
      state: CHECK_MARKS[check.verdict],
      final: check.shown === 'final',
      after,
    }
    if (check.verdict === 'red') shown.tail = tailOf(check.outputTail)
    return shown
  })
}

/** The changes per repository, from the live diff; one changed outside Hemera says so. */
function changesOf(diff: MissionDiff | null): Building.Change[] {
  return (diff?.repositories ?? [])
    .filter((one) => one.files.length > 0)
    .map((one) => {
      const shown: Building.Change = {
        repository: one.repository,
        files: one.files.length,
        added: one.added,
        deleted: one.removed,
      }
      if (one.changedOutside) shown.outside = true
      return shown
    })
}

/** A Journal line about a single call (a permission asked and its end) is a tool call: not shown. */
const meaningful = (line: JournalLine): boolean =>
  !(line.kind === 'permission' && line.fields['number'] !== undefined)

const RUNNING_SERVICE = new Set<MissionService['state']>(['starting', 'ready', 'not answering'])

function servicesOf(
  read: BuildingRead,
): Pick<Building.BuildingMoment, 'services' | 'idle' | 'catalogue'> {
  const lineOf = (service: MissionService): string =>
    read.catalogue.find((one) => one.id === service.commandId)?.line ?? service.name
  const services = read.services
    .filter((one) => RUNNING_SERVICE.has(one.state))
    .map((one): Building.Service => {
      const shown: Building.Service = {
        id: one.runId,
        name: one.name,
        state: one.state === 'not answering' ? 'blocked' : 'running',
        line: lineOf(one),
      }
      if (one.url !== null) shown.url = one.url
      return shown
    })
  const idle = read.services
    .filter((one) => !RUNNING_SERVICE.has(one.state))
    .map((one): Building.IdleService => ({
      id: one.runId,
      name: one.name,
      line: lineOf(one),
      state: one.state === 'failed' ? 'failed' : 'idle',
      dismissable: one.dismissable,
    }))
  const listed = new Set(read.services.map((one) => one.commandId))
  const catalogue = read.catalogue
    .filter((one) => one.type === 'serve' && one.scope === 'workspace' && !listed.has(one.id))
    .map((one) => ({ id: one.id, name: one.name, line: one.line }))
  return { services, idle, catalogue }
}

const millisOf = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso))

const LIVE_OF = {
  done: 'finished',
  reported: 'finished',
  failed: 'failed',
  running: 'running',
  waiting: 'running',
  waiting_for_slot: 'running',
} as const satisfies Record<string, Building.Helper['state']>

const DOCUMENTER_STEPS = {
  reported: 'Wrote the documentation',
  failed: 'Could not write the documentation',
  running: 'Writes the documentation',
  waiting_for_slot: 'Waits for a free slot',
} as const

const REVIEWER_STEPS = {
  failed: 'Could not review',
  running: 'Reads the changes',
  waiting: 'Waits for a free slot',
} as const

/** A helper's chip: running, stuck when its session gave no sign for a while, or ended. */
function helperOf(one: HelperChip): Building.Helper {
  const stuck = one.state === 'running' && one.stuck
  return {
    id: one.id,
    name: one.label,
    kind: 'helper',
    state: stuck ? 'stuck' : LIVE_OF[one.state],
    step: one.step ?? (stuck ? 'No sign for a while' : 'Starts'),
    startedAt: Date.parse(one.startedAt),
    endedAt: millisOf(one.endedAt),
  }
}

type DocumenterPass = BuildingView['documenter'][number]

function documenterOf(pass: DocumenterPass): Building.Helper {
  return {
    id: pass.id,
    name: 'Documenter',
    kind: 'documenter',
    state: LIVE_OF[pass.state],
    step: (pass.state === 'failed' ? pass.failure : null) ?? DOCUMENTER_STEPS[pass.state],
    startedAt: Date.parse(pass.startedAt),
    endedAt: millisOf(pass.endedAt),
  }
}

type ReviewPass = AutoReviewView['passes'][number]

function reviewerOf(pass: ReviewPass): Building.Helper {
  const found = pass.counts.blocking + pass.counts.warning + pass.counts.suggestion
  const step =
    pass.state === 'done'
      ? found === 0
        ? 'No finding'
        : plural(found, 'finding', 'findings')
      : ((pass.state === 'failed' ? pass.failure : null) ?? REVIEWER_STEPS[pass.state])
  return {
    id: pass.id,
    name: REVIEWER_NAMES[pass.reviewer],
    kind: 'reviewer',
    state: LIVE_OF[pass.state],
    step,
    startedAt: Date.parse(pass.startedAt),
    endedAt: millisOf(pass.endedAt),
  }
}

/** What works beside the Builder: its helpers, the documenter, the reviewers. */
function helpersOf(read: BuildingRead): Building.Helper[] {
  return [
    ...read.helpers.map(helperOf),
    ...read.building.documenter.map(documenterOf),
    ...(read.review?.passes ?? []).map(reviewerOf),
  ]
}

/** Hemera's face for what happens: what waits for the user first, then the phase. */
function faceOf(read: BuildingRead): Building.BuildingMoment['face'] {
  const waiting = read.now?.waiting ?? []
  if (waiting.some((one) => one.kind === 'permission')) return 'permission'
  if (waiting.length > 0) return 'question'
  if (read.building.state !== 'active') return 'done'
  if (read.now?.slotWait !== null && read.now?.slotWait !== undefined) return 'blocked'
  if (read.building.phase === 'final_checks') return 'checking'
  if (read.building.phase === 'review') return 'reading'
  return 'writing'
}

/** What happens now, in words: the main session's line first, then what waits, then the end. */
function nowOf(read: BuildingRead): string {
  const now = read.now
  const doing = now?.doing.find((one) => one.main) ?? now?.doing[0]
  return (
    doing?.text ??
    now?.waiting[0]?.sentence ??
    now?.slotWait ??
    now?.end.at(-1) ??
    read.building.summary ??
    'Hemera works on the tasks'
  )
}

/** The Building page, from the engine's reads. */
export function buildingMomentOf(read: BuildingRead, now: Date): Building.BuildingMoment {
  const { building } = read
  const changes = changesOf(read.diff)
  const outside = changes.find((one) => one.outside === true)?.repository
  const next = read.now?.next?.text
  const moment: Building.BuildingMoment = {
    face: faceOf(read),
    now: nowOf(read),
    elapsed: durationOf(building.elapsedSeconds),
    workspace: read.workspace ?? '',
    branch: building.repositories.find((one) => one.branch !== null)?.branch ?? '',
    round: building.round?.number ?? 0,
    requirements: requirementsOf(read, now),
    special: building.tasks
      .filter((one) => one.origin === 'review')
      .map((one) => taskOf(building, one)),
    phases: phasesOf(read),
    checks: checksOf(building),
    changes,
    ...servicesOf(read),
    helpers: helpersOf(read),
    journal: read.journal
      .filter(meaningful)
      .map((line) => ({ at: timeOf(line.at, now), text: line.text })),
    journalMore: read.journalMore,
    needs: [],
    mission: missionThingsOf(read.things, now),
  }
  const withNext = next === undefined ? moment : { ...moment, next }
  return outside === undefined ? withNext : { ...withNext, outside }
}

// --- A task's view -------------------------------------------------------------------------

const TRY_MARKS = {
  green: 'done',
  red: 'failed',
  not_verified: 'unverified',
} as const satisfies Record<NonNullable<BuildingAttemptView['verdict']>, MarkState>

function tryStateOf(attempt: BuildingAttemptView): MarkState {
  if (attempt.endedAt === null) return 'running'
  return attempt.verdict === null ? 'failed' : TRY_MARKS[attempt.verdict]
}

/** A task opened over the Building page: where it aims, its tries, its files, what judged it. */
export function taskDetailOf(
  building: BuildingView,
  task: BuildingTaskView,
  spec: Spec | null,
  now: Date,
): Building.TaskDetail {
  const [requirement] = task.requirements
  const attempts = task.attempts
    .filter((one) => one.scope === 'task')
    .toSorted((a, b) => a.number - b.number)
  const files = new Map<string, Building.TaskDetail['files'][number]>()
  for (const attempt of attempts) {
    for (const file of attempt.files) {
      const path = `${file.repository}/${file.path}`
      files.set(path, {
        path,
        added: file.added ?? 0,
        deleted: file.removed ?? 0,
        outside: file.outside,
      })
    }
  }
  const judged = attempts.findLast((one) => one.checks.length > 0)
  const decision = building.decisions.find((one) => one.id === task.decisionId)
  const detail: Building.TaskDetail = {
    task: taskOf(building, task),
    requirement:
      requirement === undefined
        ? 'Special task · asked by the automatic review'
        : `${requirement} · ${textOf(spec, requirement)}`,
    targets: task.targets.map((target) => ({
      path: `${target.repository}/${target.path}`,
      intent: target.intent,
    })),
    tries: attempts.map((one) => ({
      n: one.number,
      runner: one.runner,
      state: tryStateOf(one),
      took: durationOf(secondsBetween(one.startedAt, one.endedAt ?? now.toISOString())),
    })),
    files: [...files.values()],
    verdicts: (judged?.checks ?? []).map((check) => {
      const shown: Building.TaskDetail['verdicts'][number] = {
        name: `${check.place} · ${check.name}`,
        state: CHECK_MARKS[check.verdict],
      }
      if (check.verdict === 'red') shown.tail = tailOf(check.outputTail)
      return shown
    }),
    conflicts: attempts.flatMap((one) =>
      one.conflicts.map((conflict) => {
        const other = conflict.heldBy === task.id ? conflict.byTask : conflict.heldBy
        return {
          with: other,
          path: `${conflict.repository}/${conflict.path}`,
          settled: `${conflict.command} changed it while ${other} held it: both changes kept`,
        }
      }),
    ),
  }
  if (decision === undefined || decision.answeredAt === null) return detail
  const time = timeOf(decision.answeredAt, now)
  return {
    ...detail,
    amended: {
      by: `Your decision at ${time}`,
      what: decision.amendment ?? decision.answer ?? decision.question,
      at: time,
    },
  }
}
