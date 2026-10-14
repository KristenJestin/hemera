/**
 * The preparation recipe of a Project: what is done in a new Workspace, in order, once its
 * worktrees are made — copy a file or a folder from the main checkout, link one, run a command.
 *
 * The steps are a sequence, so each carries its number. A step is moved by its handle, with the
 * pointer or with the arrows of the keyboard once the handle has the focus, and the steps around it
 * make room on `arrival`. A copy or a link whose source is not in the main checkout says so on its
 * line, in words, in the destructive tone: the preparation would stop there. Pressing a step opens
 * its form. A step added grows into the list on `fold`, pushing what stands under it; one removed
 * folds out the same way.
 */
export type StepKind = 'copy' | 'link' | 'run'

export interface SettingsStep {
  id: string
  kind: StepKind
  /** The repository it applies under, by path; `.` for the main checkout's root. */
  place: string
  /** What a copy or a link places, under its repository. */
  path: string | null
  /** The catalogue command a run starts, by id; null for a line of its own. */
  command: string | null
  /** The line a run of its own runs, and the lines of its own for each system. */
  line: string | null
  lineLinux?: string | null | undefined
  lineWindows?: string | null | undefined
  /** What is wrong with the step, in words: a source missing from the main checkout. */
  problem?: string | undefined
}

export const KIND_WORDS: Record<StepKind, string> = { copy: 'Copy', link: 'Link', run: 'Run' }

/** What a step does to what, as its line says it: `.env.local`, `install`, `pnpm install`. */
export function whatOf(step: Pick<SettingsStep, 'kind' | 'path' | 'command' | 'line'>): string {
  if (step.kind === 'run') return step.command ?? step.line ?? ''
  return step.path ?? ''
}

/** Where a step applies, as its line says it: `api`, `root`. */
export function placeOfStep(step: Pick<SettingsStep, 'place'>): string {
  return step.place === '.' ? 'root' : step.place
}

/** What the form of a step writes. */
export type StepDraft = Omit<SettingsStep, 'id' | 'problem'>

export const NEW_STEP: StepDraft = { kind: 'copy', place: '.', path: '', command: null, line: null }
