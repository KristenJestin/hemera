/** What the end-to-end suite's probe answers (`probe.ts`), declared where the suite can read it. */

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
  /** Creates a pending environment need of the application; answers its id. */
  readonly createNeed: () => Promise<string>
  /** Every pending need of Needs you, as the window reads them: id, state and answer. */
  readonly pendingNeeds: () => Promise<ReadonlyArray<PendingNeed>>
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
