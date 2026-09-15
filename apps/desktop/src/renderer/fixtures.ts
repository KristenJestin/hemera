import type { ShellProject, ShellSession } from '@hemera/ui'

/**
 * The Projects and Sessions of a window with no database behind it (design D2-01).
 *
 * Named as what they are, in a file named as what it is: lot 3 brings the profile and lot 4
 * the real Projects and Sessions, and what they replace is this file — not a line of the shell,
 * which never learns where any of it came from.
 */
export const PROJECT_FIXTURES: ShellProject[] = [
  { id: 'atlas', name: 'Atlas', tone: 'primary', pending: 5 },
  { id: 'notes', name: 'Notes', tone: 'info', pending: 0 },
  { id: 'docs', name: 'Hemera docs', tone: 'warning', pending: 1 },
  { id: 'shop', name: 'Legacy shop', tone: 'neutral', pending: 1 },
  { id: 'playground', name: 'ML playground', tone: 'success', pending: 0 },
]

export const SESSION_FIXTURES = {
  atlas: [
    { id: 'atlas-csv', title: 'CSV invoice export' },
    { id: 'atlas-search', title: 'Full-text search' },
    { id: 'atlas-drizzle', title: 'Migrate to Drizzle 1.0' },
  ],
  notes: [{ id: 'notes-import', title: 'Import from the old notebook' }],
  docs: [
    { id: 'docs-lot-2', title: 'Write up lot 2' },
    { id: 'docs-glossary', title: 'Glossary of the core' },
  ],
  shop: [],
  playground: [{ id: 'playground-eval', title: 'Evaluate a local model' }],
} satisfies Record<string, ShellSession[]>

/** A lookup by identifier, which is how the shell asks: a Project with no Session has none. */
const BY_PROJECT = new Map<string, ShellSession[]>(Object.entries(SESSION_FIXTURES))

export function sessionsOf(projectId: string): ShellSession[] {
  return BY_PROJECT.get(projectId) ?? []
}

/**
 * What a zone says while it waits for the lot that fills it.
 *
 * Every one of them names that lot on purpose: an empty state that says "nothing here" is
 * indistinguishable from a bug, and this shell is meant to be recipe-tested while it is still
 * empty.
 */
export const EMPTY = {
  home: 'Home: lot 4 fills this page.',
  sessions: 'Sessions: lot 4.',
  journal: 'Journal: lot 4.',
  projectSettings: 'Project settings: lot 4.',
  notifications: 'Notifications: lot 4.',
  command: 'The command palette arrives with lot 4.',
  settings: 'The settings arrive with lot 3.',
} as const
