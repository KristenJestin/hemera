import type { CommandDraft, RepositoryDraft, StepDraft, VariableDraft } from '@hemera/ui'

import type { AgentSectionId } from './agent-sections.tsx'
import type { TicketSectionId } from './ticket-sections.tsx'

/** What the page needs of the window besides the settings: main's picker, the clipboard, a browser. */
export interface SettingsTools {
  /** The system's own folder picker: the folder chosen, or null. */
  readonly chooseFolder: () => Promise<string | null>
  /** What the engine refuses in a line as it is typed, in its words; null for nothing. */
  readonly checkLine: (line: string) => Promise<string | null>
  readonly copy: (text: string) => void
  /** Opens an address in the user's own browser. */
  readonly open: (url: string) => void
  /** Hemera's data folder, where a Project's Workspaces go by default. */
  readonly dataFolder: string
}

export type SectionId =
  | 'repositories'
  | 'workspaces'
  | 'commands'
  | 'preparation'
  | 'variables'
  | 'services'
  | AgentSectionId
  | TicketSectionId

/** What a dialog writes, and the draft it holds. */
export type Writing =
  | { readonly kind: 'repository'; readonly id: string | null; readonly draft: RepositoryDraft }
  | { readonly kind: 'command'; readonly id: string | null; readonly draft: CommandDraft }
  | { readonly kind: 'step'; readonly id: string | null; readonly draft: StepDraft }
  | { readonly kind: 'variable'; readonly key: string | null; readonly draft: VariableDraft }

/** The engine's refusals of the last save, next to the fields they concern; the rest at the foot. */
export interface Refusals {
  readonly path?: string | undefined
  readonly branch?: string | undefined
  readonly name?: string | undefined
  readonly globs?: string | undefined
  readonly key?: string | undefined
  readonly value?: string | undefined
  readonly foot?: string | undefined
}
