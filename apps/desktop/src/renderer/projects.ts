/**
 * The Projects as the window follows them: the list the sidebar shows, and one Project for its
 * page. Each follower reads once, then keeps up with the engine's changes, so a Project created or
 * renamed elsewhere shows without the window asking again. Plain functions over the link; the
 * hooks that hold their state are in `use-projects.ts`.
 */

import type { Project } from '@hemera/ipc'

import type { Link } from './link.ts'

export type ProjectsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly projects: ReadonlyArray<Project> }
  /** Why they could not be read, in the engine's words. */
  | { readonly kind: 'failed'; readonly sentence: string }

export type ProjectState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly project: Project }
  | { readonly kind: 'failed'; readonly sentence: string }

export interface Following {
  /** Reads again, after a failure. */
  readonly retry: () => void
  readonly stop: () => void
}

type ProjectsLink = Pick<Link, 'projects' | 'project' | 'onProjectChanges'>

/** A changed Project in its place, or added at the end: the list is in the order of creation. */
export function withChange(
  projects: ReadonlyArray<Project>,
  changed: Project,
): ReadonlyArray<Project> {
  return projects.some((project) => project.id === changed.id)
    ? projects.map((project) => (project.id === changed.id ? changed : project))
    : [...projects, changed]
}

const sentenceOf = (failure: Error): string => failure.message

type Followed<A> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: A }
  | { readonly kind: 'failed'; readonly sentence: string }

/**
 * Follows a value read once and kept up to date by the changes: listening starts before the
 * read, so a change heard while the read is on its way is applied to what it answers.
 */
function follow<A>(
  link: ProjectsLink,
  read: () => Promise<A>,
  apply: (value: A, changed: Project) => A,
  onState: (state: Followed<A>) => void,
): Following {
  let stopped = false
  let current: A | null = null
  let heard: Project[] = []
  /** Which read is the current one: an answer to an earlier one is dropped. */
  let reads = 0

  const settle = (state: Followed<A>): void => {
    if (!stopped) onState(state)
  }

  const unsubscribe = link.onProjectChanges(
    (changed) => {
      if (current === null) {
        heard.push(changed)
        return
      }
      current = apply(current, changed)
      settle({ kind: 'ready', value: current })
    },
    () => undefined,
  )

  const load = (): void => {
    reads += 1
    const asked = reads
    current = null
    settle({ kind: 'loading' })
    read().then(
      (value) => {
        if (asked !== reads) return
        let kept = value
        for (const changed of heard) kept = apply(kept, changed)
        heard = []
        current = kept
        settle({ kind: 'ready', value: kept })
      },
      (failure: Error) => {
        if (asked !== reads) return
        settle({ kind: 'failed', sentence: sentenceOf(failure) })
      },
    )
  }

  load()
  return {
    retry: load,
    stop: () => {
      stopped = true
      unsubscribe()
    },
  }
}

/** Follows every Project, for the sidebar. */
export function followProjects(
  link: ProjectsLink,
  onState: (state: ProjectsState) => void,
): Following {
  return follow(link, link.projects, withChange, (state) =>
    onState(state.kind === 'ready' ? { kind: 'ready', projects: state.value } : state),
  )
}

/** Follows one Project, for its page: its own changes, and no other's. */
export function followProject(
  link: ProjectsLink,
  id: string,
  onState: (state: ProjectState) => void,
): Following {
  return follow(
    link,
    () => link.project(id),
    (project, changed) => (changed.id === project.id ? changed : project),
    (state) => onState(state.kind === 'ready' ? { kind: 'ready', project: state.value } : state),
  )
}
