import { type MarkIcon } from '../../components/project-mark/project-mark.tsx'

/**
 * The repositories of a Project, in its settings: each on one line, what Hemera reads of it and
 * what the user chose for it.
 *
 * A line is the box that says whether new Workspaces take the repository, its icon — chosen in
 * its form, a folder until it is — and its path in the main checkout in the mono face, and what its work starts from — the remote and the base branch,
 * `origin/main` — with when that base was last fetched. A base not fetched for a while says so in
 * the warning tone; a repository Git cannot read says Git's own reason where its base would be,
 * in the destructive tone. Pressing the line opens its form, where all of it is written.
 *
 * The box is beside the line and not in it: it is a control of its own, and the line is the other
 * one. Rows on their way are the row's own shape.
 */

/** When the base of a repository was last fetched, as the settings say it. */
export type BaseFreshness =
  /** Fetched, and when: `09:02`, `yesterday`. */
  | { readonly kind: 'fetched'; readonly when: string }
  /** The last fetch failed or is old: since when, and Git's reason when there is one. */
  | { readonly kind: 'old'; readonly since: string; readonly reason?: string | undefined }
  /** Never fetched. */
  | { readonly kind: 'never' }
  /** No remote: the base is a branch of the repository itself. */
  | { readonly kind: 'local' }

export interface SettingsRepository {
  id: string
  /** Its path in the main checkout, `.` for the main checkout itself. */
  path: string
  includedByDefault: boolean
  /** The remote its base comes from; null when it has none. */
  remote: string | null
  baseBranch: string
  freshness: BaseFreshness
  /** Git's own words when the repository cannot be read. */
  unreadable?: string | undefined
  /** The icon it wears before its path, chosen in its form; a folder until one is. */
  icon?: MarkIcon | undefined
}

/** How the base's freshness is said, in a few words. */
export function freshnessWords(freshness: BaseFreshness): string {
  switch (freshness.kind) {
    case 'fetched':
      return `fetched ${freshness.when}`
    case 'old':
      return `not fetched since ${freshness.since}`
    case 'never':
      return 'never fetched'
    case 'local':
      return 'no remote'
  }
}

/** The base, as a line says it: `origin/main`, or the branch alone without a remote. */
export function baseOf(repository: Pick<SettingsRepository, 'remote' | 'baseBranch'>): string {
  return repository.remote === null
    ? repository.baseBranch
    : `${repository.remote}/${repository.baseBranch}`
}
