/**
 * The Planning page as the window feeds it: the engine's Spec, waves, inputs, discussions, Probes,
 * Prototypers, cold reads, dependencies and ticket changes in the words the page draws, and the follower that
 * reads them, keeps them up to date and sends the user's gestures. Plain values and functions over
 * the link, no React: the hook that holds them is `use-planning.ts`, and the page that draws them
 * is the design system's.
 */

import {
  PROTOTYPE_RESULT_NOTE,
  ROLE_NAMES,
  ROLES,
  TICKET_EVENT_SAID,
  type InputState,
  type PrototypeVerdict,
  type ProofSeen,
} from '@hemera/core/domain'
import type {
  ColdReadFreshness,
  ColdReadPass as EnginePass,
  Discussion as EngineDiscussion,
  DiscussionItem,
  FreezeReadiness,
  HelperChip,
  HelperDetail,
  MissionDependencies,
  Now,
  PlanningInput,
  PlanningVision,
  ProbeChip,
  ProbeDetail as EngineProbeDetail,
  Question as EngineQuestion,
  SessionSummary,
  Spec,
  SpecChange as EngineChange,
  SpecRequirement,
  TicketEventInfo,
  Wave as EngineWave,
} from '@hemera/ipc'
import {
  freezeOf,
  planningNow,
  type FreezeOffer,
  type Mentionable,
  type NeedRow,
  type Planner,
  type Planning,
  type PlanningNow,
} from '@hemera/ui'

import type { Link } from './link.ts'
import { stageOf } from './missions.ts'
import { whenOf } from './needs.ts'

/** A date the page says in words; what is not a date is kept as it is. */
const wordsOf = (at: string, now: Date): string =>
  Number.isNaN(Date.parse(at)) ? at : whenOf(at, now)

/** A Proof block as the page draws it. */
export const proofOf = (proof: ProofSeen): Planning.Proof => ({
  mode: proof.mode,
  actions: proof.actions,
  startingData: proof.starting_data,
  expected: proof.expected,
  test: proof.test === undefined ? undefined : `${proof.test.repository}/${proof.test.path}`,
  command: proof.command ?? proof.test?.command,
  seenToday: proof.seen_today,
  observed: proof.observed,
  keyLine: proof.key_line,
  fromProbe: proof.from_probe,
})

/** A requirement as the page draws it, with the living requirement it changes once read. */
export const requirementOf = (
  one: SpecRequirement,
  living: ReadonlyMap<string, string>,
): Planning.Requirement => ({
  id: one.id,
  domain: one.domain,
  delta: one.delta,
  text: one.text,
  living:
    one.livingRef === null
      ? undefined
      : {
          ref: one.livingRef,
          text: living.get(one.livingRef) ?? null,
          proposed: one.againstProposed,
        },
  scenarios: one.scenarios.map((scenario) => ({
    id: scenario.id,
    when: scenario.when,
    then: scenario.then,
    proof: scenario.proof === null ? null : proofOf(scenario.proof),
  })),
})

/** Where an input stands, by its id; one the engine did not list yet was just received. */
const stateOf = (inputs: ReadonlyArray<PlanningInput>, id: string | null): InputState =>
  inputs.find((input) => input.id === id)?.state ?? 'received'

/** A question as the page draws it: only the answers proposed from the ticket that still wait. */
export const questionOf = (one: EngineQuestion, now: Date): Planning.Question => ({
  id: one.id,
  text: one.text,
  why: one.why,
  options: one.options,
  recommended: one.recommended,
  recommendedReason: one.recommendedReason,
  section: one.section,
  fromFinding: one.fromFinding,
  replaces: one.replaces,
  replacedBy: one.replacedBy,
  state: one.state,
  waitingNote: one.waitingNote,
  retiredReason: one.retiredReason,
  mootDecision: one.mootDecision,
  answers: one.answers.map((answer) => ({
    version: answer.version,
    optionId: answer.optionId,
    text: answer.text,
    at: wordsOf(answer.at, now),
    inputState: answer.inputState ?? 'received',
  })),
  drafts: one.drafts.map((draft) => ({ text: draft.text, at: wordsOf(draft.at, now) })),
  proposals: one.proposals
    .filter((proposal) => proposal.state === 'proposed')
    .map((proposal) => ({
      id: proposal.id,
      author: proposal.commentAuthor,
      comment: proposal.comment,
      text: proposal.text,
    })),
})

/** The questions of every wave, one list in the order they were asked: the page draws no wave. */
export const questionsOf = (waves: ReadonlyArray<EngineWave>, now: Date): Planning.Question[] =>
  waves.flatMap((wave) => wave.questions.map((question) => questionOf(question, now)))

export const discussionOf = (one: EngineDiscussion, now: Date): Planning.Discussion => ({
  id: one.id,
  label: one.label,
  item: one.item,
  state: one.state,
  outcome: one.outcome,
  decision: one.decision,
  proposal:
    one.proposal === null ? null : { text: one.proposal.text, at: wordsOf(one.proposal.at, now) },
  waitsOn: one.waitsOn,
  plannerFailed: one.plannerFailed,
  messages: one.messages.map((message) => ({
    author: message.author,
    text: message.text,
    proposal: message.proposal,
    at: wordsOf(message.at, now),
  })),
})

/**
 * Where a Probe stands on its chip: one whose worktree is wiped has ended all the same, on its
 * report or without one.
 */
const probeStateOf = (one: ProbeChip): Planning.ProbeState =>
  one.state === 'wiping' || one.state === 'wiped'
    ? one.outcome === null
      ? 'failed'
      : 'done'
    : one.state

/** A Probe's chip, its instants in milliseconds. */
export const probeOf = (one: ProbeChip): Planning.Probe => ({
  id: one.id,
  label: one.label,
  question: one.question,
  scenario: one.scenario,
  state: probeStateOf(one),
  stuck: one.stuck,
  step: one.step ?? undefined,
  startedAt: Date.parse(one.startedAt),
  endedAt: one.endedAt === null ? null : Date.parse(one.endedAt),
  outcome: one.outcome,
})

/** A Probe whole, as its report opens over the page. */
export const probeDetailOf = (one: EngineProbeDetail): Planning.ProbeDetail => ({
  ...probeOf(one),
  report:
    one.report === null
      ? null
      : {
          answer: one.report.answer,
          actions: one.report.actions,
          command: one.report.command,
          observed: one.report.observed,
          keyLine: one.report.key_line,
          evidence: one.evidence,
        },
  failure: one.failure,
})

/**
 * A Prototyper as the page draws it: its chip, and once read, what it was asked, what it handed
 * back (without the line its result ends on for the Planner), its folder and the verdict given
 * with what was said of it.
 */
export const prototypeOf = (
  chip: HelperChip,
  detail: HelperDetail | null | undefined,
): Planning.Prototype => ({
  id: chip.id,
  label: chip.label,
  question: detail?.brief ?? null,
  state: chip.state,
  stuck: chip.stuck,
  step: chip.step ?? undefined,
  startedAt: Date.parse(chip.startedAt),
  endedAt: chip.endedAt === null ? null : Date.parse(chip.endedAt),
  result: detail?.result?.replace(`\n${PROTOTYPE_RESULT_NOTE}`, '') ?? null,
  folder: detail?.folder ?? null,
  failure: detail?.failure ?? null,
  verdict: chip.verdict,
  verdictNote: chip.verdict === null ? null : (detail?.verdictNote ?? null),
})

export const passOf = (one: EnginePass): Planning.ColdReadPass => ({
  id: one.id,
  label: one.label,
  requestedBy: one.requestedBy,
  state: one.state,
  stuck: one.stuck,
  startedAt: Date.parse(one.startedAt ?? one.askedAt),
  endedAt: one.endedAt === null ? null : Date.parse(one.endedAt),
  failure: one.failure,
  findings: one.findings.map((finding) => ({
    id: finding.id,
    severity: finding.severity,
    where: finding.where,
    text: finding.text,
    tasksOnly: finding.tasksOnly,
    fate: finding.fate,
    questionId: finding.questionId,
    fixedWhat: finding.fixedWhat,
  })),
})

const changeOf = (one: EngineChange, now: Date): Planning.SpecChange => ({
  item: one.item,
  before: one.before,
  after: one.after,
  at: wordsOf(one.at, now),
})

/** What the last pass read against the Spec now; before any pass, nothing is behind. */
export const freshnessOf = (one: ColdReadFreshness, now: Date): Planning.Freshness => ({
  current: one.readVersion === null || one.readVersion === one.specVersion,
  changes: one.changes.map((change) => changeOf(change, now)),
})

/** Where a change of the ticket stands when it has no input of its own. */
const EVENT_INPUT: Readonly<Record<TicketEventInfo['state'], InputState>> = {
  new: 'received',
  delivered: 'delivered',
  analysed: 'delivered',
  integrated: 'integrated',
  seen: 'integrated',
}

/** The changes of the ticket the user has not seen yet; null when there is none. */
export function ticketOf(
  events: ReadonlyArray<TicketEventInfo>,
  inputs: ReadonlyArray<PlanningInput>,
  now: Date,
): PlanningData['ticket'] {
  const unseen = events.filter((event) => event.seenAt === null && event.state !== 'seen')
  const first = unseen[0]
  if (first === undefined) return null
  return {
    key: first.key,
    changes: unseen.map((event) => ({
      id: event.id,
      what: TICKET_EVENT_SAID[event.kind],
      difference: event.difference,
      at: wordsOf(event.detectedAt, now),
      inputState: event.input === null ? EVENT_INPUT[event.state] : stateOf(inputs, event.input),
    })),
  }
}

type PlanningData = Planning.PlanningData

/** Everything the page is drawn from, as the engine answered it. */
export interface PlanningRead {
  readonly spec: Spec
  readonly waves: ReadonlyArray<EngineWave>
  readonly inputs: ReadonlyArray<PlanningInput>
  readonly visions: ReadonlyArray<PlanningVision>
  readonly discussions: ReadonlyArray<EngineDiscussion>
  readonly probes: ReadonlyArray<ProbeChip>
  readonly prototypes: ReadonlyArray<HelperChip>
  /** What was read of each Prototyper: null while it is read. */
  readonly prototypeResults: ReadonlyMap<string, HelperDetail | null>
  readonly passes: ReadonlyArray<EnginePass>
  readonly freshness: ColdReadFreshness
  readonly dependencies: MissionDependencies
  readonly events: ReadonlyArray<TicketEventInfo>
  /** What changed since the user last read the Spec. */
  readonly changes: ReadonlyArray<EngineChange>
  /** The text of each living requirement a requirement changes, once read. */
  readonly living: ReadonlyMap<string, string>
  /** The title of each mission of the Project, by its key. */
  readonly titles: ReadonlyMap<string, string>
}

/** The page whole: the requirements removed from the Spec are no longer drawn. */
export function planningDataOf(read: PlanningRead, now: Date): PlanningData {
  const { spec } = read
  const requirements = spec.requirements.filter((one) => !one.removed)
  const triage = spec.triage
  return {
    frozen: spec.frozen,
    sections: spec.sections.map((section) => ({
      name: section.name,
      title: section.title,
      body: section.body,
      state: section.state,
    })),
    requirementsState: requirements.length > 0 ? 'written' : 'empty',
    requirements: requirements.map((one) => requirementOf(one, read.living)),
    tasks: spec.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      result: task.result,
      scenarios: task.scenarios,
      targets: task.targets.map((target) => ({
        repository: target.repository,
        path: target.path,
        intent: target.intent,
      })),
      dependsOn: task.dependsOn,
    })),
    questions: questionsOf(read.waves, now),
    discussions: read.discussions.map((one) => discussionOf(one, now)),
    probes: read.probes.map(probeOf),
    prototypes: read.prototypes.map((one) => prototypeOf(one, read.prototypeResults.get(one.id))),
    passes: read.passes.map(passOf),
    freshness: freshnessOf(read.freshness, now),
    dependencies: read.dependencies.dependsOn.map((one) => ({
      id: one.id,
      dependsOnKey: one.dependsOnKey,
      dependsOnTitle: read.titles.get(one.dependsOnKey) ?? null,
      dependsOnStage: stageOf(one.dependsOnStage),
      reason: one.reason,
      state: one.state,
    })),
    changes: read.changes.map((change) => changeOf(change, now)),
    visions: read.visions.map((vision) => ({
      id: vision.id,
      text: vision.text,
      at: wordsOf(vision.at, now),
      inputState: stateOf(read.inputs, vision.input),
    })),
    triage:
      triage === null || triage.state !== 'pending'
        ? null
        : {
            kind: triage.kind,
            ref: triage.ref,
            text: triage.text,
            basedOnProposed: triage.basedOnProposed,
          },
    ticket: ticketOf(read.events, read.inputs, now),
  }
}

/**
 * The Planner as the page knows it, from its last session and the mission's Now: at work in a turn
 * (its own line, else none: a silent turn), starting (the slot it waits for), between its turns,
 * without a sign for a while, or stopped. Its line is kept by the engine after its turn, so the
 * page believes it only while the Planner works.
 */
export function plannerOf(now: Now | null, sessions: ReadonlyArray<SessionSummary>): Planner {
  const doing = now?.doing.find((line) => line.main)?.text
  const next = now?.next?.text ?? null
  const session = sessions.filter((one) => one.role === 'planner').at(-1)
  const planner = (state: Planner['state'], said: string | null = null): Planner => ({
    state,
    doing: said,
    next,
    reason: state === 'failed' ? (session?.stateReason ?? null) : null,
  })
  switch (session?.state) {
    case 'working':
      return planner('working', doing === undefined || doing === '' ? null : doing)
    case 'starting':
      return planner('working', now?.slotWait ?? null)
    case 'stuck':
      return planner('stuck')
    case 'failed':
      return planner('failed')
    default:
      return planner('idle', doing ?? null)
  }
}

/** The head of the page: its Now line, and Freeze with what stands before it. */
export interface PlanningHead {
  readonly now: PlanningNow | null
  readonly freeze: FreezeOffer
}

/** Said under Freeze while the engine has not said yet whether it is ready. */
const CHECKING = 'Hemera checks what is left before Freeze'

/**
 * The head, from what the page shows and what the engine says of the Freeze: the page's reasons
 * first; when they explain nothing, the engine's, which knows more (an open discussion, a Spec
 * changed since the cold read).
 */
export function planningHeadOf(
  view: PlanningView,
  readiness: FreezeReadiness | null,
): PlanningHead {
  if (view.data === null) return { now: null, freeze: { shown: false } }
  const facts = { data: view.data, planner: view.planner, declaredComplete: view.declaredComplete }
  const offer = freezeOf(facts)
  const freeze: FreezeOffer =
    !offer.shown || offer.reasons.length > 0
      ? offer
      : readiness === null
        ? { shown: true, reasons: [CHECKING] }
        : { shown: true, reasons: readiness.ready ? [] : readiness.unsettled }
  return { now: planningNow(facts), freeze }
}

/**
 * A need of the mission as For you lists it: who asks, by the role that asked ("Probe", "Cold
 * read"), Hemera when no agent did; its card may be discussed, the mission being in Planning.
 */
export function planningNeedOf(row: NeedRow): Planning.PlanningNeed {
  const role = ROLES.find((one) => one === row.need.role)
  const name = role === undefined ? 'Hemera' : ROLE_NAMES[role].replace(/^(the|a) /, '')
  return {
    id: row.id,
    who: `${name.charAt(0).toUpperCase()}${name.slice(1)}`,
    need: { ...row.need, planning: true },
  }
}

/** Whether a Prototyper's chip says more than what was read of it: another state or verdict. */
const moved = (held: HelperDetail, chip: HelperChip): boolean =>
  held.state !== chip.state || held.verdict !== chip.verdict

/** What the page shows of the follower. */
export interface PlanningView {
  readonly data: PlanningData | null
  readonly error?: string | undefined
  /** The Planner's session, as the page knows it. */
  readonly planner: Planner
  /** Whether the Planner declared the Spec complete and Hemera's check passed. */
  readonly declaredComplete: boolean
  /** Why the last gesture did not go through, in words. */
  readonly refused?: string | undefined
  /** The Project's missions, which a field can mention. */
  readonly mentionables: ReadonlyArray<Mentionable>
  /** The report of each Probe opened: null while it is read. */
  readonly reports: ReadonlyMap<string, Planning.ProbeDetail | null>
  /** The mission's Prototypers (#222), the first launched first: each one's chip, as the engine gives it. */
  readonly prototypes: ReadonlyArray<HelperChip>
  /** The result of each Prototyper opened: null while it is read. */
  readonly prototypeResults: ReadonlyMap<string, HelperDetail | null>
}

export const LOADING_PLANNING: PlanningView = {
  data: null,
  planner: plannerOf(null, []),
  declaredComplete: false,
  mentionables: [],
  reports: new Map(),
  prototypes: [],
  prototypeResults: new Map(),
}

/**
 * What the page can do. A gesture settles once the engine has taken it; one that sends what the
 * user wrote is refused to its field, any other refusal is said in the head.
 */
export interface PlanningFollowing {
  readonly answer: (
    questionId: string,
    answer: { optionId: string } | { text: string },
  ) => Promise<void>
  readonly waitOnSomeone: (questionId: string, note: string | null) => Promise<void>
  readonly acceptProposed: (proposalId: string, text: string | null) => Promise<void>
  readonly dismissProposed: (proposalId: string) => Promise<void>
  readonly dismissFinding: (findingId: string) => Promise<void>
  readonly runColdRead: () => Promise<void>
  readonly decideDependency: (id: string, accept: boolean) => Promise<void>
  readonly giveVision: (text: string) => Promise<void>
  readonly markRead: () => Promise<void>
  readonly keepPlanning: () => Promise<void>
  readonly seenTicketChange: (eventId: string) => Promise<void>
  /** Reads a Probe's report, for its view. */
  readonly openProbe: (probeId: string) => void
  /** Asks for a prototype: the Planner is handed it and launches the Prototyper (#222). */
  readonly askPrototype: (question: string) => Promise<void>
  /** The user's verdict on a Prototyper's result, with what they say of it. */
  readonly judgePrototype: (
    helperId: string,
    verdict: PrototypeVerdict,
    note: string | null,
  ) => Promise<void>
  /** Reads a Prototyper's result, for its view. */
  readonly openPrototype: (helperId: string) => void
  /** The first message on an item opens its discussion; the next ones are said in it. */
  readonly say: (item: DiscussionItem, text: string) => Promise<void>
  /** Closes the item's discussion on the proposal the user read. */
  readonly accept: (item: DiscussionItem) => Promise<void>
  readonly close: (item: DiscussionItem, decision: string | null) => Promise<void>
  /** Reads again, after a failure. */
  readonly retry: () => void
  readonly stop: () => void
}

export type PlanningLink = Pick<
  Link,
  | 'onSpec'
  | 'changesSince'
  | 'markRead'
  | 'addVision'
  | 'visions'
  | 'waves'
  | 'answer'
  | 'waitOnSomeone'
  | 'planningInputs'
  | 'acceptProposedAnswer'
  | 'dismissProposedAnswer'
  | 'keepAfterTriage'
  | 'onDiscussions'
  | 'openDiscussion'
  | 'sayInDiscussion'
  | 'acceptDiscussion'
  | 'closeDiscussion'
  | 'onProbes'
  | 'probe'
  | 'onPrototypes'
  | 'helper'
  | 'askPrototype'
  | 'judgePrototype'
  | 'onColdReads'
  | 'coldReadAgain'
  | 'dismissFinding'
  | 'coldReadFreshness'
  | 'dependencies'
  | 'decideDependency'
  | 'ticketEvents'
  | 'acknowledgeTicketEvent'
  | 'memoryNow'
  | 'onMemory'
  | 'missionSessions'
  | 'livingSpecRequirement'
  | 'missions'
>

/** What a refresh reads besides the streams. */
interface Around {
  readonly waves: ReadonlyArray<EngineWave>
  readonly inputs: ReadonlyArray<PlanningInput>
  readonly visions: ReadonlyArray<PlanningVision>
  readonly freshness: ColdReadFreshness
  readonly dependencies: MissionDependencies
  readonly events: ReadonlyArray<TicketEventInfo>
  readonly changes: ReadonlyArray<EngineChange>
  readonly sessions: ReadonlyArray<SessionSummary>
}

const sameItem = (one: DiscussionItem, other: DiscussionItem): boolean =>
  one.kind === other.kind && one.id === other.id

/**
 * Follows a mission's Planning. The Spec, the discussions, the Probes, the cold reads and the
 * mission's Memory are streams; the waves, the inputs, the visions, the dependencies and the
 * ticket's changes have none, so they are read again after each thing heard on any stream — the
 * answer of a read a later one overtook is dropped. The first time a written Spec is shown, it is
 * marked read at its version: from then on, what the Planner writes is marked until the user
 * presses Mark as read.
 */
export function followPlanning(
  link: PlanningLink,
  mission: { readonly id: string; readonly projectId: string },
  onView: (view: PlanningView) => void,
  clock: () => Date = () => new Date(),
): PlanningFollowing {
  const missionId = mission.id
  let stopped = false
  let spec: Spec | null = null
  let around: Around | null = null
  let discussions: ReadonlyArray<EngineDiscussion> = []
  let probes: ReadonlyArray<ProbeChip> = []
  let passes: ReadonlyArray<EnginePass> = []
  let now: Now | null = null
  let error: string | undefined
  let refused: string | undefined
  let markedOnce = false
  let reports: ReadonlyMap<string, Planning.ProbeDetail | null> = new Map()
  let prototypes: ReadonlyArray<HelperChip> = []
  let prototypeResults: ReadonlyMap<string, HelperDetail | null> = new Map()
  let mentionables: ReadonlyArray<Mentionable> = []
  const living = new Map<string, string>()
  const asked = new Set<string>()
  const titles = new Map<string, string>()
  let reads = 0
  let unsubscribe: Array<() => void> = []

  const emit = (): void => {
    if (stopped) return
    onView({
      data:
        spec === null || around === null
          ? null
          : planningDataOf(
              {
                spec,
                ...around,
                discussions,
                probes,
                prototypes,
                prototypeResults,
                passes,
                living,
                titles,
              },
              clock(),
            ),
      error,
      planner: plannerOf(now, around?.sessions ?? []),
      declaredComplete: spec !== null && spec.declaredCompleteVersion !== null,
      refused,
      mentionables,
      reports,
      prototypes,
      prototypeResults,
    })
  }

  const failed = (failure: Error): void => {
    if (stopped) return
    error = failure.message
    emit()
  }

  /** Reads what has no stream; a read overtaken by a later one is not heard. */
  const refresh = (): void => {
    if (spec === null) return
    const shown = spec
    readLiving(shown)
    const mine = ++reads
    const since = shown.readVersion
    Promise.all([
      link.waves(missionId),
      link.planningInputs(missionId),
      link.visions(missionId),
      link.coldReadFreshness(missionId),
      link.dependencies(missionId),
      link.ticketEvents(missionId),
      since === null || since >= shown.version
        ? Promise.resolve([])
        : link.changesSince(missionId, since),
      link.missionSessions(missionId),
    ]).then(
      ([waves, inputs, visions, freshness, dependencies, events, changes, sessions]) => {
        if (stopped || mine !== reads) return
        around = { waves, inputs, visions, freshness, dependencies, events, changes, sessions }
        error = undefined
        emit()
      },
      (failure: Error) => {
        if (mine === reads) failed(failure)
      },
    )
  }

  /**
   * Reads the text of each living requirement the Spec changes, once each; a read that failed is
   * asked again at the next.
   */
  const readLiving = (heard: Spec): void => {
    for (const one of heard.requirements) {
      const ref = one.livingRef
      if (ref === null || asked.has(ref)) continue
      asked.add(ref)
      link.livingSpecRequirement(ref).then(
        (detail) => {
          living.set(ref, detail.text)
          emit()
        },
        // Meanwhile the requirement says which living requirement it changes, not its text.
        () => {
          asked.delete(ref)
        },
      )
    }
  }

  const readMissions = (): void => {
    link.missions(mission.projectId).then(
      (missions) => {
        for (const one of missions) titles.set(one.key, one.title)
        mentionables = missions
          .filter((one) => one.id !== missionId)
          .map((one) => ({ kind: 'mission', id: one.key, label: one.key, detail: one.title }))
        emit()
      },
      // Without them, a dependency is said by its key and nothing can be mentioned.
      () => undefined,
    )
  }

  const heardSpec = (heard: Spec): void => {
    spec = heard
    if (
      !markedOnce &&
      heard.readVersion === null &&
      heard.sections.some((section) => section.state === 'written')
    ) {
      markedOnce = true
      link.markRead(missionId, heard.version).catch(() => undefined)
    }
    refresh()
    emit()
  }

  const start = (): void => {
    unsubscribe = [
      link.onSpec(missionId, heardSpec, failed),
      link.onDiscussions(
        missionId,
        (heard) => {
          discussions = heard
          refresh()
          emit()
        },
        failed,
      ),
      link.onProbes(
        missionId,
        (heard) => {
          probes = heard
          // A report open while its Probe moves is read again.
          for (const id of reports.keys()) {
            if (heard.some((one) => one.id === id)) readReport(id)
          }
          emit()
        },
        failed,
      ),
      link.onPrototypes(
        missionId,
        (heard) => {
          prototypes = heard
          // Each Prototyper is read once heard, for its question and its result, and again when
          // its state or its verdict moves; one being read is not asked again.
          for (const chip of heard) {
            const held = prototypeResults.get(chip.id)
            if (held === undefined || (held !== null && moved(held, chip))) {
              prototypeResults = new Map([...prototypeResults, [chip.id, null]])
              readPrototype(chip.id)
            }
          }
          emit()
        },
        failed,
      ),
      link.onColdReads(
        missionId,
        (heard) => {
          passes = heard
          refresh()
          emit()
        },
        failed,
      ),
      link.onMemory(
        missionId,
        (change) => {
          now = change.now
          refresh()
          emit()
        },
        // The Now line is a help: the page goes on without it.
        () => undefined,
      ),
    ]
    link.memoryNow(missionId).then(
      (read) => {
        now ??= read
        emit()
      },
      () => undefined,
    )
    readMissions()
  }

  function readReport(probeId: string): void {
    link.probe(probeId).then(
      (detail) => {
        reports = new Map([...reports, [probeId, probeDetailOf(detail)]])
        emit()
      },
      (failure: Error) => {
        refused = failure.message
        emit()
      },
    )
  }

  function readPrototype(helperId: string): void {
    link.helper(helperId).then(
      (detail) => {
        prototypeResults = new Map([...prototypeResults, [helperId, detail]])
        emit()
      },
      (failure: Error) => {
        refused = failure.message
        emit()
      },
    )
  }

  /** The gestures on their way, by what they act on: each is sent once at a time. */
  const flying = new Map<string, Promise<void>>()

  /**
   * Sends a gesture: what it changes comes back on the streams, or by the next read. The same
   * gesture pressed again while it is on its way is not sent again: the one on its way is handed
   * back. A refusal of what the user wrote goes back to its field, which keeps the words and says
   * why; any other refusal is said in the head.
   */
  const gesture = <A>(key: string, send: () => Promise<A>, written = false): Promise<void> => {
    const onItsWay = flying.get(key)
    if (onItsWay !== undefined) return onItsWay
    refused = undefined
    emit()
    const sent = send()
      .then(
        () => refresh(),
        (failure: Error) => {
          if (written) throw failure
          if (stopped) return
          refused = failure.message
          emit()
        },
      )
      .finally(() => flying.delete(key))
    flying.set(key, sent)
    return sent
  }

  const discussionOn = (item: DiscussionItem): EngineDiscussion | undefined =>
    discussions.find((one) => sameItem(one.item, item))

  start()

  return {
    answer: (questionId, answer) =>
      gesture(
        `answer ${questionId}`,
        () => link.answer(missionId, questionId, answer),
        'text' in answer,
      ),
    waitOnSomeone: (questionId, note) =>
      gesture(`wait ${questionId}`, () => link.waitOnSomeone(missionId, questionId, note)),
    acceptProposed: (proposalId, text) =>
      gesture(
        `proposal ${proposalId}`,
        () => link.acceptProposedAnswer(proposalId, text),
        text !== null,
      ),
    dismissProposed: (proposalId) =>
      gesture(`proposal ${proposalId}`, () => link.dismissProposedAnswer(proposalId)),
    dismissFinding: (findingId) =>
      gesture(`finding ${findingId}`, () => link.dismissFinding(missionId, findingId)),
    runColdRead: () => gesture('cold read', () => link.coldReadAgain(missionId)),
    decideDependency: (id, accept) =>
      gesture(`dependency ${id}`, () => link.decideDependency(id, accept)),
    giveVision: (text) => gesture('vision', () => link.addVision(missionId, text), true),
    markRead: () => {
      if (spec === null) return Promise.resolve()
      const version = spec.version
      return gesture('read', () => link.markRead(missionId, version))
    },
    keepPlanning: () => gesture('triage', () => link.keepAfterTriage(missionId)),
    seenTicketChange: (eventId) =>
      gesture(`ticket ${eventId}`, () => link.acknowledgeTicketEvent(eventId)),
    openProbe: (probeId) => {
      if (!reports.has(probeId)) reports = new Map([...reports, [probeId, null]])
      emit()
      readReport(probeId)
    },
    askPrototype: (question) =>
      gesture('prototype', () => link.askPrototype(missionId, question), true),
    judgePrototype: (helperId, verdict, note) =>
      gesture(`prototype ${helperId}`, () => link.judgePrototype(helperId, verdict, note)),
    openPrototype: (helperId) => {
      if (!prototypeResults.has(helperId)) {
        prototypeResults = new Map([...prototypeResults, [helperId, null]])
      }
      emit()
      readPrototype(helperId)
    },
    say: (item, text) => {
      const open = discussionOn(item)
      return gesture(
        `say ${item.kind} ${item.id}`,
        () =>
          open === undefined
            ? link.openDiscussion(missionId, item, text)
            : link.sayInDiscussion(open.id, text),
        true,
      )
    },
    accept: (item) => {
      const open = discussionOn(item)
      const proposal = open?.proposal
      if (open === undefined || proposal === null || proposal === undefined) {
        return Promise.resolve()
      }
      return gesture(`discussion ${open.id}`, () => link.acceptDiscussion(open.id, proposal.at))
    },
    close: (item, decision) => {
      const open = discussionOn(item)
      if (open === undefined) return Promise.resolve()
      return gesture(
        `discussion ${open.id}`,
        () => link.closeDiscussion(open.id, decision),
        decision !== null,
      )
    },
    retry: () => {
      for (const stop of unsubscribe) stop()
      error = undefined
      emit()
      start()
    },
    stop: () => {
      stopped = true
      for (const stop of unsubscribe) stop()
    },
  }
}
