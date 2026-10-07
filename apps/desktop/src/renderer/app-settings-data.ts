/**
 * What the application's settings show (#50), read from the engine's answers: plain values and no
 * React. Each section of `packages/ui` takes its own shape; these are the readings between.
 */

import type {
  AgentState,
  AutomaticBackups,
  HemeraAutoStatus,
  JevKeyStatus,
  NotificationSettings,
  PermissionDecision,
  RoleModels,
} from '@hemera/ipc'
import {
  EFFORTS,
  type AgentRow,
  type Decision,
  type JevKey,
  type RoleModel,
  type RowErrors,
  type SoundStyleChoice,
  type Toggle,
} from '@hemera/ui'

import { OWN_DEFAULT } from './chat-items.ts'

/** An agent as the Agents section shows it: its install line, or its state once installed. */
export function agentRowsOf(agents: ReadonlyArray<AgentState>): AgentRow[] {
  return agents.map((agent) => ({
    name: agent.label,
    state: agent.installed
      ? {
          installed: true,
          version: agent.version ?? '',
          signedIn: agent.signedIn,
          signIn: agent.loginHint,
          installer: agent.installer === 'unknown' ? undefined : agent.installer,
          update:
            agent.latest !== null && agent.version !== null && agent.latest !== agent.version
              ? agent.latest
              : undefined,
          bareRefused: 'reason' in agent.qualification ? agent.qualification.reason : undefined,
        }
      : { installed: false, install: agent.installHint },
  }))
}

/** The Jev key's state, as the Hemera Auto section words it. */
export const jevKeyOf = (status: JevKeyStatus): JevKey =>
  status === 'storage-unavailable' ? 'unavailable' : status

export interface NotificationsShown {
  readonly events: Toggle[]
  readonly sounds: Toggle[]
  readonly style: string
  readonly styles: SoundStyleChoice[]
}

/** One switch per kind of event and per sound, then the sound styles. */
export const notificationsOf = (settings: NotificationSettings): NotificationsShown => ({
  events: settings.kinds.map((kind) => ({ id: kind.id, label: kind.label, on: kind.on })),
  sounds: settings.sounds.map((sound) => ({ id: sound.sound, label: sound.label, on: sound.on })),
  style: settings.style,
  styles: settings.styles.map((style) => ({ id: style.style, label: style.label })),
})

/** A time of day as the settings say it: `08:12`, in the machine's own zone unless one is given. */
const timeOf = (iso: string, zone?: string): string =>
  new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(
    new Date(iso),
  )

/** The automatic backups: `12, the last at 08:12`, or none yet. */
export const backupsSaid = (backups: AutomaticBackups, zone?: string): string =>
  backups.count === 0 || backups.latest === null
    ? 'None yet'
    : `${String(backups.count)}, the last at ${timeOf(backups.latest, zone)}`

/** Hemera Auto's decisions, the newest first: the call in short, and whether it ran or asked. */
export const decisionsOf = (
  decisions: ReadonlyArray<PermissionDecision>,
  zone?: string,
): Decision[] =>
  decisions
    .filter((decision) => decision.settled === 'jev')
    .toSorted((a, b) => b.sequence - a.sequence)
    .map((decision) => ({
      id: String(decision.sequence),
      call: `${decision.tool} · ${decision.target}`,
      verdict: decision.verdict === 'allow' ? 'ran' : 'asked',
      when: timeOf(decision.occurredAt, zone),
    }))

/**
 * Restores the backup folder the user chooses; nothing when none is chosen. A restore relaunches
 * Hemera; one the engine refuses answers its sentence.
 */
export const restoreChosen = (
  choose: () => Promise<string | null>,
  restore: (folder: string) => Promise<void>,
): Promise<string | undefined> =>
  choose().then((folder) =>
    folder === null
      ? undefined
      : restore(folder).then(
          () => undefined,
          (refused: Error) => refused.message,
        ),
  )

/** What a section read from the engine: on its way, answered, or refused in words. */
export type Read<A> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: A }
  | { readonly kind: 'failed'; readonly sentence: string }

/** Reads `asked` into `onState`, on its way first; stopped, it says nothing more. */
export function reading<A>(asked: Promise<A>, onState: (state: Read<A>) => void): () => void {
  let stopped = false
  onState({ kind: 'loading' })
  asked.then(
    (value) => {
      if (!stopped) onState({ kind: 'ready', value })
    },
    (failure: Error) => {
      if (!stopped) onState({ kind: 'failed', sentence: failure.message })
    },
  )
  return () => {
    stopped = true
  }
}

/** The rows' refusals without `row`'s. */
const without = (errors: RowErrors, row: string): RowErrors =>
  Object.fromEntries(Object.entries(errors).filter(([key]) => key !== row))

/**
 * A setting written from its row: answered, the row's refusal goes and `onDone` takes the answer;
 * refused, the row says what could not be done and why.
 */
export function writing<A>(
  asked: Promise<A>,
  row: string,
  what: string,
  onErrors: (change: (before: RowErrors) => RowErrors) => void,
  onDone: (value: A) => void = () => undefined,
): void {
  asked.then(
    (value) => {
      onErrors((before) => without(before, row))
      onDone(value)
    },
    (failure: Error) =>
      onErrors((before) => ({ ...without(before, row), [row]: `${what}: ${failure.message}` })),
  )
}

/** Who judges now, as Hemera Auto's section says it. */
export const judgeSaid = (judge: HemeraAutoStatus['judge']): string =>
  judge === 'Jev' ? 'Hemera Auto (Jev)' : 'Hemera asks'

/** What became of a key saved or removed: the status the engine answered, or why not in words. */
export type KeyWritten =
  | { readonly kind: 'done'; readonly status: HemeraAutoStatus }
  | {
      readonly kind: 'refused'
      readonly sentence: string
      /** What the engine answered, when it answered: the key is not stored. */
      readonly status: HemeraAutoStatus | null
    }

/**
 * A key saved (`saved` wanted) or removed (`missing` wanted). Without protected storage the
 * engine stores nothing and says so in its status: that is a refusal too, with what is missing.
 */
export function keyWritten(
  asked: Promise<HemeraAutoStatus>,
  wanted: 'saved' | 'missing',
): Promise<KeyWritten> {
  const what = wanted === 'saved' ? 'The key could not be stored' : 'The key could not be removed'
  return asked.then(
    (status): KeyWritten =>
      status.key === wanted
        ? { kind: 'done', status }
        : {
            kind: 'refused',
            sentence: `${what}: ${status.missing ?? 'the system could not protect it.'}`,
            status,
          },
    (failure: Error): KeyWritten => ({
      kind: 'refused',
      sentence: `${what}: ${failure.message}`,
      status: null,
    }),
  )
}

/**
 * Each role at the application's level: the model the application chose, or none where it leaves
 * the role on Hemera's default (what the role would resolve to is not the application's choice).
 */
export const appRolesOf = (roles: ReadonlyArray<RoleModels>): RoleModel[] =>
  roles.map((role) => ({
    role: role.displayName,
    model:
      role.app === null
        ? null
        : {
            agent: role.app.agent,
            model: role.app.model ?? OWN_DEFAULT,
            effort: EFFORTS.find((effort) => effort === role.app?.effort),
          },
  }))
