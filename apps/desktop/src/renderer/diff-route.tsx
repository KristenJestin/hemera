/**
 * The diff of a mission (#497), as a view over its base: the tree and every file in one scroll,
 * followed live, the comments under their lines and what the user writes on them; the layout
 * toggle and the live mark in the sheet's head; and the version an outdated comment was written
 * on, opened over the diff.
 */

import type { CommentedVersion as Version, Mission } from '@hemera/ipc'
import {
  CommentedVersion,
  DiffActions,
  DiffView,
  type Diff,
  type DiffLayout,
  type StageTarget,
} from '@hemera/ui'
import { Predicate } from 'effect'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

import { followDiff, type DiffFollowing, type DiffState } from './diff-follow.ts'
import { commentsOf, repositoriesOf, sourceOf } from './diff-model.ts'
import type { Link } from './link.ts'
import { stageOf } from './missions.ts'

/** A value of the window that a view's head and its body both read, kept while the window lives. */
function shared<A>(initial: A) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    read: () => value,
    write: (next: A) => {
      value = next
      for (const listener of listeners) listener()
    },
    watch: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Split or stacked: the user's choice, kept from one diff to the next. Stacked at rest. */
const LAYOUT = shared<DiffLayout>('stacked')

/** The comment whose commented version is open, by mission. */
const VERSION = shared<ReadonlyMap<string, string>>(new Map())

const useLayout = (): DiffLayout => useSyncExternalStore(LAYOUT.watch, LAYOUT.read, LAYOUT.read)

/** Where the mission's diff is read from, as the head knows it before the diff is read. */
const liveSourceOf = (mission: Mission): Diff.DiffSource =>
  sourceOf(
    { source: 'live', checkpoint: null, repositories: [] },
    stageOf(mission.stage),
    mission.round,
  )

/** The sheet's head: the live mark while a round writes, and split or stacked. */
export function DiffHeadActions({ mission }: { mission: Mission }): ReactNode {
  return <DiffActions source={liveSourceOf(mission)} layout={useLayout()} onLayout={LAYOUT.write} />
}

const EMPTY: DiffState = { diff: null, sides: new Map(), review: null }

/** The view's body: the mission's diff, followed for as long as it is open. */
export function DiffSheet({
  link,
  mission,
  open,
}: {
  link: Link
  mission: Mission
  /** Opens a view over the diff: the commented version. */
  open: (view: string) => void
}): ReactNode {
  const [state, setState] = useState<DiffState>(EMPTY)
  const [attempt, setAttempt] = useState(0)
  const following = useRef<DiffFollowing | null>(null)
  const [target, setTarget] = useState<StageTarget | null>(null)
  const nonce = useRef(0)
  const layout = useLayout()

  useEffect(() => {
    const current = followDiff(link, mission.id, setState)
    following.current = current
    return () => {
      current.stop()
      following.current = null
      setState(EMPTY)
    }
  }, [link, mission.id, attempt])

  const stage = stageOf(mission.stage)
  const repositories = useMemo(
    () => (state.diff === null ? [] : repositoriesOf(state.diff, state.sides)),
    [state.diff, state.sides],
  )
  const { comments, byName } = useMemo(
    () =>
      state.review === null
        ? { comments: [], byName: new Map() }
        : commentsOf(state.review, new Date()),
    [state.review],
  )
  const source =
    state.diff === null ? liveSourceOf(mission) : sourceOf(state.diff, stage, mission.round)

  return (
    <DiffView
      repositories={repositories}
      comments={comments}
      source={source}
      layout={layout}
      loading={state.diff === null && state.error === undefined}
      error={
        state.error === undefined
          ? undefined
          : { words: state.error, onRetry: () => setAttempt((before) => before + 1) }
      }
      notice={state.notice}
      target={target}
      onFile={(id) => {
        nonce.current += 1
        setTarget({ kind: 'file', id, nonce: nonce.current })
      }}
      onShow={(id) => following.current?.show(id)}
      onAdd={(comment) => following.current?.add(comment)}
      onAction={(name, action) => following.current?.act(name, action)}
      onEdit={(name, text) => following.current?.edit(name, text)}
      onFollowUp={(name, text) => following.current?.followUp(name, text)}
      onOpenForge={(url) => window.open(url, '_blank', 'noopener')}
      onOpenVersion={(name) => {
        const one = byName.get(name)
        if (one === undefined) return
        VERSION.write(new Map([...VERSION.read(), [mission.id, one.id]]))
        open('version')
      }}
    />
  )
}

/** The version of a file an outdated comment was written on, the comment on its lines. */
export function VersionSheet({ link, mission }: { link: Link; mission: Mission }): ReactNode {
  const asked = (): string | undefined => VERSION.read().get(mission.id)
  const feedbackId = useSyncExternalStore(VERSION.watch, asked, asked)
  const [read, setRead] = useState<{
    version: Version
    comment: Diff.DiffComment | undefined
  } | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (feedbackId === undefined) return undefined
    let stopped = false
    Promise.all([link.commentedVersion(feedbackId), link.reviewState(mission.id)]).then(
      ([version, review]) => {
        if (stopped) return
        const { comments, byName } = commentsOf(review, new Date())
        const name = [...byName].find(([, one]) => one.id === feedbackId)?.[0]
        setRead({ version, comment: comments.find((one) => one.id === name) })
      },
      (failure: Error) => {
        if (!stopped) setError(failure.message)
      },
    )
    return () => {
      stopped = true
      setRead(null)
      setError(undefined)
    }
  }, [link, mission.id, feedbackId])

  if (error !== undefined) return <p className="p-4 text-sm text-muted-foreground">{error}</p>
  if (read === null || read.comment === undefined) return null
  const content = read.version.content
  return (
    <CommentedVersion
      comment={read.comment}
      contents={Predicate.isTagged(content, 'DiffText') ? content.text : null}
      why={
        Predicate.isTagged(content, 'DiffWithheld')
          ? content.reason
          : 'This version holds no text: it is a binary file.'
      }
      onOpenForge={(url) => window.open(url, '_blank', 'noopener')}
    />
  )
}
