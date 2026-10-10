/**
 * What notifies: the registry of event kinds, the notices the engine tells main as events commit,
 * and the switches behind them.
 *
 * A kind is registered once, in code: its id, the words of its switch, whether it is on by
 * default, its sound and its importance, the committed domain event it listens to, how it reads
 * that event (its facts, or nothing when the event is not one of its own), the words of one event
 * and where a click on it leads. A kind never polls: it hears a committed event, or nothing. Later
 * tickets add their kinds to `KINDS`; none of them notifies by itself.
 *
 * The words are masked before they leave the engine: a mission's title or what a need says may
 * quote a secret. Main does the rest (grouping, where it shows, the sound), and a need that is
 * answered, expires or is withdrawn is never notified: it is told as ended, so its notification
 * goes away.
 */

import { type NeedFields, missionKey } from '@hemera/core/domain'
import {
  DEFAULT_SOUND_STYLE,
  HomeTarget,
  MissionTarget,
  type KindSetting,
  NeedEnded,
  NeedTarget,
  type Notice,
  type NoticeFeed,
  type NoticeProject,
  NoticeRaised,
  type NoticeTone,
  type NotificationSettings,
  type NotificationTarget,
  ProjectTarget,
  SOUND_STYLES,
  SOUNDS,
  type Sound,
  SoundStyle,
  UnknownNotificationKind,
} from '@hemera/ipc'
import { eq, like, sql } from 'drizzle-orm'
import { Effect, Match, Option, Predicate, Result, Schema, Stream } from 'effect'

import { DomainEvents } from './domain-events.ts'
import type { DomainEvent } from './journal.ts'
import { getNeed } from './needs.ts'
import { Secrets } from './secrets.ts'
import { Database, type DatabaseError, refusedWhile } from './storage/database.ts'
import { appPreferences, missions, probes, projects, workspaces } from './storage/schema.ts'

/** What every kind's facts say: the Project, the mission's key, and the need, when there are. */
export interface Facts {
  readonly project: NoticeProject | null
  readonly missionKey: string | null
  readonly needId: string | null
}

/** One event's words: what it is about, and what happened in a few words. */
export interface Words {
  readonly subject: string
  readonly what: string
}

/** A kind as a ticket registers it, with the facts it reads of its event. */
export interface KindDefinition<F extends Facts> {
  readonly id: string
  /** The words of its switch in the settings. */
  readonly label: string
  readonly byDefault: boolean
  readonly sound: Sound | null
  /** Which sound a group plays: the highest wins. */
  readonly importance: number
  readonly tone: NoticeTone
  /** The committed domain event it listens to, by type. */
  readonly source: string
  /** Its facts, or none when the event is not one of this kind. */
  readonly facts: (event: DomainEvent) => Effect.Effect<Option.Option<F>, DatabaseError, Database>
  readonly words: (facts: F) => Words
  /** Where a click leads. A kind without one is refused by the registry. */
  readonly route?: ((facts: F) => NotificationTarget) | undefined
}

/** A kind as the registry holds it, its facts kept to itself. */
export interface NotificationKind {
  readonly id: string
  readonly label: string
  readonly byDefault: boolean
  readonly sound: Sound | null
  readonly importance: number
  readonly source: string
  readonly routed: boolean
  /** The event said as a notice, its words masked; none when the event is not of this kind. */
  readonly notice: (
    event: DomainEvent,
    mask: (text: string) => string,
  ) => Effect.Effect<Option.Option<Notice>, DatabaseError, Database>
}

export function defineKind<F extends Facts>(definition: KindDefinition<F>): NotificationKind {
  const { route } = definition
  return {
    id: definition.id,
    label: definition.label,
    byDefault: definition.byDefault,
    sound: definition.sound,
    importance: definition.importance,
    source: definition.source,
    routed: route !== undefined,
    notice: (event, mask) =>
      Effect.map(
        definition.facts(event),
        Option.flatMap((facts) => {
          if (route === undefined) return Option.none()
          const words = definition.words(facts)
          return Option.some({
            id: `${definition.id}:${String(event.sequence)}`,
            kind: definition.id,
            sound: definition.sound,
            importance: definition.importance,
            tone: definition.tone,
            project:
              facts.project === null
                ? null
                : { id: facts.project.id, name: mask(facts.project.name) },
            missionKey: facts.missionKey,
            subject: mask(words.subject),
            what: mask(words.what),
            target: route(facts),
            needId: facts.needId,
          })
        }),
      ),
  }
}

/** A registry that cannot be: two kinds under one id, or a kind that leads nowhere. */
export class RegistryRefused extends Schema.TaggedError<RegistryRefused>()('RegistryRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `The notification kinds were refused: ${this.reason}.`
  }
}

export interface Registry {
  readonly kinds: ReadonlyArray<NotificationKind>
}

/** The kinds, checked: every id once, every kind with a route. */
export function registryOf(
  kinds: ReadonlyArray<NotificationKind>,
): Result.Result<Registry, RegistryRefused> {
  const seen = new Set<string>()
  for (const kind of kinds) {
    if (seen.has(kind.id)) {
      return Result.fail(new RegistryRefused({ reason: `two kinds share the id ${kind.id}` }))
    }
    seen.add(kind.id)
    if (!kind.routed) {
      return Result.fail(new RegistryRefused({ reason: `the kind ${kind.id} has no route` }))
    }
  }
  return Result.succeed({ kinds })
}

// --- What the events say ----------------------------------------------------------------------

const readText = Schema.decodeUnknownOption(Schema.String)

const projectOf = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a Project')))
    return row ?? null
  })

const missionOf = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({ prefix: missions.keyPrefix, number: missions.keyNumber, title: missions.title })
      .from(missions)
      .where(eq(missions.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a mission')))
    return row === undefined ? null : { key: missionKey(row.prefix, row.number), title: row.title }
  })

interface NeedFacts extends Facts {
  readonly fields: NeedFields
  readonly mission: { readonly key: string; readonly title: string } | null
}

/** A need just created and still pending, with its Project and its mission. */
const createdNeed = (event: DomainEvent) =>
  Effect.gen(function* () {
    const need = yield* Effect.option(getNeed(event.entityId))
    if (Option.isNone(need) || need.value.state !== 'pending') return Option.none<NeedFacts>()
    const { owner, fields } = need.value
    const projectId = Match.value(owner).pipe(
      Match.tag('Application', () => null),
      Match.orElse((owned) => owned.projectId),
    )
    const project = projectId === null ? null : yield* projectOf(projectId)
    const mission = Predicate.isTagged(owner, 'Mission') ? yield* missionOf(owner.missionId) : null
    return Option.some<NeedFacts>({
      project,
      mission,
      missionKey: mission?.key ?? null,
      needId: need.value.id,
      fields,
    })
  })

/** What a need is, in a few words: the question asked is not, the kind of ask is. */
const needWhat = Match.type<NeedFields>().pipe(
  Match.tagsExhaustive({
    Environment: (fields) => fields.missing,
    Decision: () => 'a decision waits for you',
    Error: (fields) => fields.failed,
    Permission: () => 'a permission waits for you',
  }),
)

/** A need's words: its mission's title, its Project's name, or Hemera's own. */
const needWords = (facts: NeedFacts): Words => ({
  subject: facts.mission?.title ?? facts.project?.name ?? 'Hemera needs you',
  what: needWhat(facts.fields),
})

/** A mission's need opens the mission on it; a Project's opens its Needs you; the app's, Home. */
const needRoute = (facts: NeedFacts): NotificationTarget => {
  if (facts.project === null) return HomeTarget.make({ projectId: null })
  if (facts.mission === null || facts.needId === null) {
    return HomeTarget.make({ projectId: facts.project.id })
  }
  return NeedTarget.make({
    projectId: facts.project.id,
    missionKey: facts.mission.key,
    needId: facts.needId,
  })
}

const needOfKind = (isError: boolean) => (event: DomainEvent) =>
  Effect.map(
    createdNeed(event),
    Option.filter((facts) => Predicate.isTagged(facts.fields, 'Error') === isError),
  )

interface WorkspaceFacts extends Facts {
  readonly workspace: string
}

/** A Workspace whose preparation ended in the state asked for. */
const preparationEnded = (state: 'ready' | 'failed') => (event: DomainEvent) =>
  Effect.gen(function* () {
    if (Option.getOrNull(readText(event.payload['state'])) !== state) {
      return Option.none<WorkspaceFacts>()
    }
    const database = yield* Database
    const [row] = yield* database
      .select({ name: workspaces.name, projectId: workspaces.projectId, folder: workspaces.folder })
      .from(workspaces)
      .where(eq(workspaces.id, event.entityId))
      .pipe(Effect.mapError(refusedWhile('reading a Workspace')))
    if (row === undefined) return Option.none<WorkspaceFacts>()
    // A Probe's own Workspace (#89): its preparation is the Probe's to report, never the user's.
    const [probe] = yield* database
      .select({ id: probes.id })
      .from(probes)
      .where(eq(probes.folder, row.folder))
      .pipe(Effect.mapError(refusedWhile('reading the Probes')))
    if (probe !== undefined) return Option.none<WorkspaceFacts>()
    const project = yield* projectOf(row.projectId)
    if (project === null) return Option.none<WorkspaceFacts>()
    return Option.some<WorkspaceFacts>({
      project,
      missionKey: null,
      needId: null,
      workspace: row.name,
    })
  })

const workspaceRoute = (facts: WorkspaceFacts): NotificationTarget =>
  facts.project === null
    ? HomeTarget.make({ projectId: null })
    : ProjectTarget.make({ projectId: facts.project.id })

interface TriageFacts extends Facts {
  readonly project: NoticeProject
  readonly missionKey: string
  readonly title: string
}

/** The Planner's triage answer (#85): not a need, but the mission waits on the user. */
const triaged = (event: DomainEvent) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select({
        projectId: missions.projectId,
        prefix: missions.keyPrefix,
        number: missions.keyNumber,
        title: missions.title,
      })
      .from(missions)
      .where(eq(missions.id, event.entityId))
      .pipe(Effect.mapError(refusedWhile('reading a mission')))
    if (row === undefined) return Option.none<TriageFacts>()
    const project = yield* projectOf(row.projectId)
    if (project === null) return Option.none<TriageFacts>()
    return Option.some<TriageFacts>({
      project,
      missionKey: missionKey(row.prefix, row.number),
      needId: null,
      title: row.title,
    })
  })

interface LivingSpecFacts extends Facts {
  readonly project: NoticeProject
}

/** A bootstrap of a living spec that ended done (#93): ready to review. */
const livingSpecReady = (event: DomainEvent) =>
  Effect.gen(function* () {
    if (Option.getOrNull(readText(event.payload['state'])) !== 'done') {
      return Option.none<LivingSpecFacts>()
    }
    const project = yield* projectOf(event.entityId)
    if (project === null) return Option.none<LivingSpecFacts>()
    return Option.some<LivingSpecFacts>({ project, missionKey: null, needId: null })
  })

interface TrackerFacts extends Facts {
  readonly project: NoticeProject
  readonly provider: string
}

/** A ticket provider that became unreachable (#95), with its Project. */
const trackerDown = (event: DomainEvent) =>
  Effect.gen(function* () {
    const projectId = Option.getOrNull(readText(event.payload['projectId']))
    const project = projectId === null ? null : yield* projectOf(projectId)
    if (project === null) return Option.none<TrackerFacts>()
    return Option.some<TrackerFacts>({
      project,
      missionKey: null,
      needId: null,
      provider: Option.getOrElse(readText(event.payload['provider']), () => 'A tracker'),
    })
  })

interface BuiltFacts extends TriageFacts {
  /** The mission it depended on, now delivered. */
  readonly on: string
}

/** A mission whose last dependency reached Done (#92): not a need, and nothing starts. */
const unblocked = (event: DomainEvent) =>
  Effect.map(
    triaged(event),
    Option.map((facts): BuiltFacts => ({
      ...facts,
      on: Option.getOrElse(readText(event.payload['on']), () => ''),
    })),
  )

interface TicketFacts extends TriageFacts {
  readonly key: string
}

/** A change found on a mission's ticket (#97), of the kinds given. */
const ticketChanged =
  (...kinds: ReadonlyArray<string>) =>
  (event: DomainEvent) =>
    Effect.gen(function* () {
      if (!kinds.includes(Option.getOrElse(readText(event.payload['kind']), () => ''))) {
        return Option.none<TicketFacts>()
      }
      const facts = yield* triaged(event)
      return Option.map(facts, (found): TicketFacts => ({
        ...found,
        key: Option.getOrElse(readText(event.payload['key']), () => 'the ticket'),
      }))
    })

/** A write of a mission's remote Spec that failed (#98), with the ticket's key. */
const ticketWriteFailed = (event: DomainEvent) =>
  Effect.map(
    triaged(event),
    Option.map((found): TicketFacts => ({
      ...found,
      key: Option.getOrElse(readText(event.payload['key']), () => 'the ticket'),
    })),
  )

/** The importance of each sound, a group playing the highest: an error, then a need, then done. */
export const IMPORTANCE = { error: 3, 'needs-you': 2, done: 1, none: 0 } as const

/** The kinds this version registers. Later tickets add theirs here, each with its tests. */
export const KINDS: ReadonlyArray<NotificationKind> = [
  defineKind({
    id: 'need',
    label: 'A need waits for you',
    byDefault: true,
    sound: 'needs-you',
    importance: IMPORTANCE['needs-you'],
    tone: 'you',
    source: 'need.created',
    facts: needOfKind(false),
    words: needWords,
    route: needRoute,
  }),
  defineKind({
    id: 'failure',
    label: 'Something failed',
    byDefault: true,
    sound: 'error',
    importance: IMPORTANCE.error,
    tone: 'failed',
    source: 'need.created',
    facts: needOfKind(true),
    words: needWords,
    route: needRoute,
  }),
  defineKind({
    id: 'workspace-ready',
    label: 'A Workspace is prepared',
    byDefault: false,
    sound: null,
    importance: IMPORTANCE.none,
    tone: 'done',
    source: 'workspace.preparation_ended',
    facts: preparationEnded('ready'),
    words: (facts) => ({ subject: facts.workspace, what: 'its preparation finished' }),
    route: workspaceRoute,
  }),
  defineKind({
    id: 'workspace-failed',
    label: 'A Workspace preparation failed',
    byDefault: true,
    sound: 'error',
    importance: IMPORTANCE.error,
    tone: 'failed',
    source: 'workspace.preparation_ended',
    facts: preparationEnded('failed'),
    words: (facts) => ({ subject: facts.workspace, what: 'its preparation failed' }),
    route: workspaceRoute,
  }),
  defineKind({
    id: 'triage-answer',
    label: 'The Planner answers that an input is not new work',
    byDefault: true,
    sound: 'needs-you',
    importance: IMPORTANCE['needs-you'],
    tone: 'you',
    source: 'planning.triaged',
    facts: triaged,
    words: (facts) => ({ subject: facts.title, what: 'the Planner answered the triage' }),
    route: (facts) =>
      MissionTarget.make({ projectId: facts.project.id, missionKey: facts.missionKey }),
  }),
  defineKind({
    id: 'questions-asked',
    label: 'The Planner asks questions',
    byDefault: true,
    sound: 'needs-you',
    importance: IMPORTANCE['needs-you'],
    tone: 'you',
    source: 'planning.wave_asked',
    // A wave is not a need: the mission's facts, as for the triage answer.
    facts: triaged,
    words: (facts) => ({ subject: facts.title, what: 'the Planner asks questions' }),
    route: (facts) =>
      MissionTarget.make({ projectId: facts.project.id, missionKey: facts.missionKey }),
  }),
  defineKind({
    id: 'living-spec-ready',
    label: 'The living spec of a Project is ready to review',
    byDefault: false,
    sound: null,
    importance: IMPORTANCE.none,
    tone: 'done',
    source: 'livingSpec.bootstrap_finished',
    facts: livingSpecReady,
    words: (facts) => ({ subject: facts.project.name, what: 'its living spec is ready to review' }),
    route: (facts) => ProjectTarget.make({ projectId: facts.project.id }),
  }),
  defineKind({
    id: 'tracker-unreachable',
    label: 'A tracker is unreachable',
    byDefault: true,
    sound: 'error',
    importance: IMPORTANCE.error,
    tone: 'failed',
    source: 'tickets.provider_unreachable',
    facts: trackerDown,
    words: (facts) => ({
      subject: facts.provider,
      what: 'it cannot be read; its tickets keep the version last read',
    }),
    route: (facts) => ProjectTarget.make({ projectId: facts.project.id }),
  }),
  defineKind({
    id: 'ticket-comment',
    label: 'A comment is added to or edited on a mission’s ticket',
    byDefault: true,
    sound: null,
    importance: IMPORTANCE.none,
    tone: 'outside',
    source: 'tickets.changed',
    facts: ticketChanged('comment_added', 'comment_edited'),
    words: (facts) => ({ subject: facts.title, what: `a comment on ${facts.key}` }),
    route: (facts) =>
      MissionTarget.make({ projectId: facts.project.id, missionKey: facts.missionKey }),
  }),
  defineKind({
    id: 'ticket-changed',
    label: 'The description of a mission’s ticket changed',
    byDefault: true,
    sound: null,
    importance: IMPORTANCE.none,
    tone: 'outside',
    source: 'tickets.changed',
    facts: ticketChanged('description_changed'),
    words: (facts) => ({
      subject: facts.title,
      what: `${facts.key} changed: the mission is outdated`,
    }),
    route: (facts) =>
      MissionTarget.make({ projectId: facts.project.id, missionKey: facts.missionKey }),
  }),
  defineKind({
    id: 'ticket-status',
    label: 'The status of a mission’s ticket changed',
    byDefault: true,
    sound: null,
    importance: IMPORTANCE.none,
    tone: 'outside',
    source: 'tickets.changed',
    facts: ticketChanged('status_changed'),
    words: (facts) => ({ subject: facts.title, what: `the status of ${facts.key} changed` }),
    route: (facts) =>
      MissionTarget.make({ projectId: facts.project.id, missionKey: facts.missionKey }),
  }),
  defineKind({
    id: 'ticket-write-failed',
    label: 'The Spec could not be written to the ticket',
    byDefault: true,
    sound: 'error',
    importance: IMPORTANCE.error,
    tone: 'failed',
    source: 'tickets.write_failed',
    facts: ticketWriteFailed,
    words: (facts) => ({
      subject: facts.title,
      what: `the Spec could not be written to ${facts.key}`,
    }),
    route: (facts) =>
      MissionTarget.make({ projectId: facts.project.id, missionKey: facts.missionKey }),
  }),
  defineKind({
    id: 'can-be-built',
    label: 'A mission can be built: what it depended on is delivered',
    byDefault: true,
    sound: 'done',
    importance: IMPORTANCE.done,
    tone: 'done',
    source: 'mission.unblocked',
    facts: unblocked,
    words: (facts) => ({ subject: facts.title, what: `it can be built: ${facts.on} is delivered` }),
    route: (facts) =>
      MissionTarget.make({ projectId: facts.project.id, missionKey: facts.missionKey }),
  }),
  defineKind({
    id: 'workspace-prepared',
    label: 'A mission’s Workspace preparation done: it is Building',
    byDefault: true,
    sound: 'done',
    importance: IMPORTANCE.done,
    tone: 'done',
    source: 'building.workspace_ready',
    facts: triaged,
    words: (facts) => ({ subject: facts.title, what: 'its Workspace is ready: Building' }),
    route: (facts) =>
      MissionTarget.make({ projectId: facts.project.id, missionKey: facts.missionKey }),
  }),
  defineKind({
    id: 'workspace-preparation-failed',
    label: 'A mission’s Workspace preparation failed: it stays Ready',
    byDefault: true,
    sound: 'error',
    importance: IMPORTANCE.error,
    tone: 'failed',
    source: 'building.workspace_failed',
    facts: triaged,
    words: (facts) => ({ subject: facts.title, what: 'the preparation of its Workspace failed' }),
    route: (facts) =>
      MissionTarget.make({ projectId: facts.project.id, missionKey: facts.missionKey }),
  }),
]

/** The registry of this version, checked when the engine loads: a bad one is a defect. */
export const REGISTRY: Registry = Result.getOrThrow(registryOf(KINDS))

// --- The feed -----------------------------------------------------------------------------------

/** The events of a need that ends: never notified, and its notification goes. */
const NEED_ENDS = new Set(['need.answered', 'need.expired', 'need.withdrawn'])

/** What one committed event tells main. */
const toldBy = (registry: Registry, event: DomainEvent) =>
  Effect.gen(function* () {
    if (event.entityKind === 'need' && NEED_ENDS.has(event.type)) {
      return [NeedEnded.make({ needId: event.entityId })]
    }
    const secrets = yield* Secrets
    const told: NoticeFeed[] = []
    for (const kind of registry.kinds) {
      if (kind.source !== event.type) continue
      const notice = yield* kind.notice(event, secrets.mask)
      if (Option.isSome(notice)) told.push(NoticeRaised.make({ notice: notice.value }))
    }
    return told
  })

/** What the committed events tell main, from a subscription already taken. */
export const noticesOf = (
  registry: Registry,
  committed: Stream.Stream<DomainEvent>,
): Stream.Stream<NoticeFeed, DatabaseError, Database | Secrets> =>
  committed.pipe(
    Stream.mapEffect((event) => toldBy(registry, event)),
    Stream.flatMap((told) => Stream.fromIterable(told)),
  )

/**
 * Each notice and each need ended, as events commit, for as long as main listens. Nothing is told
 * again at a start: the needs still pending are on Home.
 */
export const noticeFeed = (
  registry: Registry,
): Stream.Stream<NoticeFeed, DatabaseError, Database | DomainEvents | Secrets> =>
  Stream.unwrap(
    Effect.map(
      DomainEvents.use((events) => events.subscribe),
      (committed) => noticesOf(registry, committed),
    ),
  )

// --- The settings -------------------------------------------------------------------------------

const KIND_KEY = 'notifications.kind.'
const SOUND_KEY = 'notifications.sound.'
const STYLE_KEY = 'notifications.style'

const switchCodec = Schema.fromJsonString(Schema.Boolean)
const readSwitch = Schema.decodeUnknownOption(switchCodec)
const writeSwitch = Schema.encodeSync(switchCodec)

const styleCodec = Schema.fromJsonString(SoundStyle)
const readStyle = Schema.decodeUnknownOption(styleCodec)
const writeStyle = Schema.encodeSync(styleCodec)

/** The words of each sound's switch. */
export const SOUND_LABELS: Record<Sound, string> = {
  'needs-you': 'Something needs you',
  error: 'Something failed',
  done: 'Something is done',
}

/** The name of each sound style in the settings. */
export const SOUND_STYLE_LABELS: Record<SoundStyle, string> = {
  hemera: 'Hemera',
  minimal: 'Minimal',
  soft: 'Soft',
  glass: 'Glass',
  arcade: 'Arcade',
  mechanical: 'Mechanical',
  organic: 'Organic',
  dreamy: 'Dreamy',
  scifi: 'Sci-fi',
  rubber: 'Rubber',
  cinematic: 'Cinematic',
  studio: 'Studio',
  zen: 'Zen',
}

/**
 * The switches as they stand, listed from the registry: a kind registered later appears with its
 * default, and a switch this version cannot read answers its default too. So does the sound style:
 * Hemera's own when none was chosen or the one kept is not a style of this version.
 */
export const readNotificationSettings = (
  registry: Registry,
): Effect.Effect<NotificationSettings, DatabaseError, Database> =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(appPreferences)
      .where(like(appPreferences.key, 'notifications.%'))
      .pipe(Effect.mapError(refusedWhile('reading the notification settings')))
    const kept = new Map(rows.map(({ key, value }) => [key, value]))
    const on = (key: string, byDefault: boolean) =>
      Option.getOrElse(readSwitch(kept.get(key)), () => byDefault)
    const kinds = registry.kinds.map((kind): KindSetting => ({
      id: kind.id,
      label: kind.label,
      on: on(KIND_KEY + kind.id, kind.byDefault),
      byDefault: kind.byDefault,
      sound: kind.sound,
    }))
    const sounds = SOUNDS.map((sound) => ({
      sound,
      label: SOUND_LABELS[sound],
      on: on(SOUND_KEY + sound, true),
    }))
    const style = Option.getOrElse(readStyle(kept.get(STYLE_KEY)), () => DEFAULT_SOUND_STYLE)
    const styles = SOUND_STYLES.map((one) => ({ style: one, label: SOUND_STYLE_LABELS[one] }))
    return { kinds, sounds, style, styles }
  })

const writeRow = (key: string, value: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    yield* database
      .insert(appPreferences)
      .values({ key, value })
      .onConflictDoUpdate({ target: appPreferences.key, set: { value: sql`excluded.value` } })
      .pipe(Effect.mapError(refusedWhile('writing the notification settings')))
  })

/** Turns a kind on or off, and answers the switches as they now stand. */
export const setNotificationKind = (registry: Registry, id: string, on: boolean) =>
  Effect.gen(function* () {
    if (!registry.kinds.some((kind) => kind.id === id)) {
      return yield* new UnknownNotificationKind({ id })
    }
    yield* writeRow(KIND_KEY + id, writeSwitch(on))
    return yield* readNotificationSettings(registry)
  })

/** Turns a sound on or off, and answers the switches as they now stand. */
export const setNotificationSound = (registry: Registry, sound: Sound, on: boolean) =>
  Effect.andThen(writeRow(SOUND_KEY + sound, writeSwitch(on)), readNotificationSettings(registry))

/** Chooses the sound style, and answers the settings as they now stand. */
export const setSoundStyle = (registry: Registry, style: SoundStyle) =>
  Effect.andThen(writeRow(STYLE_KEY, writeStyle(style)), readNotificationSettings(registry))
