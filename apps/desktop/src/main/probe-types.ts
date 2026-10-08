/** What the end-to-end suite's probe answers (`probe.ts`), declared where the suite can read it. */

import type { NeedFields, NeedOwner } from '@hemera/core/domain'

import type { FakeScript } from '../engine/agents/fake.ts'

export interface LoadMeasure {
  readonly items: number
  readonly millis: number
  readonly mainRssBefore: number
  readonly mainRssAfter: number
  readonly engineWorkingSetBeforeKb: number
  readonly engineWorkingSetAfterKb: number
}

export interface HemeraProbe {
  readonly enginePid: () => number | undefined
  /** Changes the theme preference the way the window does: written by the engine, worn by main. */
  readonly changeTheme: (theme: 'system' | 'light' | 'dark') => Promise<void>
  /** Creates a Project through the engine, as the window will; answers its id. */
  readonly createProject: (name: string, folder: string) => Promise<string>
  /** Writes a backup of the Profile into `folder`; answers the backup folder written. */
  readonly backUp: (folder: string) => Promise<string>
  /** Restores the backup folder `folder` the way the window does, relaunch included. */
  readonly restore: (folder: string) => Promise<void>
  /** Closes every window's port from main's side. */
  readonly closeWindowLinks: () => void
  /** `process.crash()` inside the engine. */
  readonly crashEngine: () => void
  /** Has the engine start an agents' process for `program`, write `input` to it, and read it. */
  readonly startAgents: (program: string, input: ReadonlyArray<string>) => Promise<number>
  /** The lines the agents' process delivered so far. */
  readonly agentsLines: () => ReadonlyArray<string>
  /** How the agents' process's stream ended (the sentence of its error), and its lines. */
  readonly agentsOutcome: () => Promise<{ readonly ended: string; readonly lines: string[] }>
  /** Streams `count` items of `size` characters from the engine, one acknowledgement each. */
  readonly load: (count: number, size: number) => Promise<LoadMeasure>
  /**
   * Creates a pending need of that owner with those fields (something missing of the
   * application's unless said), as an engine service would; answers its id.
   */
  readonly createNeed: (owner?: NeedOwner, fields?: NeedFields) => Promise<string>
  /** Creates a mission of the Project from an idea, as the window will; answers its id and key. */
  readonly createMission: (
    projectId: string,
    sentence: string,
  ) => Promise<{ readonly id: string; readonly key: string }>
  /** Where the setup of the Project named `name` stands, as the window reads it: `none` unasked. */
  readonly setupStanding: (name: string) => Promise<string>
  /** Every pending need of Needs you, as the window reads them: id, state and answer. */
  readonly pendingNeeds: () => Promise<ReadonlyArray<PendingNeed>>
  /** A fake agent writes `count` Journal lines of a new mission over `folder`, in the background. */
  readonly agentWrites: (folder: string, count: number) => Promise<void>
  /** What the Memory holds: the agent's events and lines, and each mission's files. */
  readonly memory: () => Promise<MemoryState>
  /**
   * What every agent's session started from now on does: the fake agent's script, the agent of
   * the headless suite. A script crosses as JSON: `between` is left out.
   */
  readonly scriptAgent: (script: FakeScript) => Promise<void>
}

export interface MemoryState {
  readonly agentEvents: number
  readonly agentLines: number
  readonly journalLines: number
  readonly files: ReadonlyArray<{
    readonly key: string
    readonly names: ReadonlyArray<string>
    readonly journalFileLines: number
  }>
}

export interface PendingNeed {
  readonly id: string
  readonly state: string
  readonly answered: boolean
}

declare global {
  // oxlint-disable-next-line no-var -- a global is declared with `var`
  var hemeraProbe: HemeraProbe | undefined
}
