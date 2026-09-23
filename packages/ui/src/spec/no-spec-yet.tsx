import { type ReactNode, useRef } from 'react'

import { Button } from '../components/button/button.tsx'
import { IconPlus } from '../icons.ts'
import type { DraftSpecView } from './model.ts'

/**
 * What the panel of a `define` Session with no Spec shows (lot 19, brief screen 3; D7-07).
 *
 * Switching a Session to `define` creates nothing: it defines a Spec, and which one is the
 * reader's to say. One calm block, then — create one from this conversation, or join a draft
 * the Project already has — with those drafts listed under it, each with the Session writing it,
 * because joining a draft that has a writer makes this Session its reader.
 */

const BLOCK = 'flex h-full items-center justify-center p-6'

const BOX = 'flex w-full max-w-sm flex-col'

const TITLE = 'text-base font-semibold'

const SAYS = 'mt-1 text-sm text-muted-foreground'

const LABEL = 'text-xs font-medium tracking-wide text-muted-foreground uppercase'

const DRAFT =
  'grid w-full grid-cols-6 gap-x-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-ring hover:bg-accent'

const KEY = 'row-span-2 pt-0.5 font-mono text-xs text-muted-foreground'

const DRAFT_TITLE = 'col-span-5 truncate'

const WRITER = 'col-span-5 text-xs text-muted-foreground'

export interface NoSpecYetProps {
  /** The Project whose drafts are offered. */
  projectName: string
  drafts: DraftSpecView[]
  /** Creates a Spec from this conversation; this Session writes it. */
  onCreate: () => void
  /** Joins a draft; this Session reads it until it takes the write right. */
  onJoin: (key: string) => void
}

export function NoSpecYet({ projectName, drafts, onCreate, onJoin }: NoSpecYetProps): ReactNode {
  const list = useRef<HTMLUListElement>(null)
  return (
    <div className={BLOCK}>
      <div className={BOX}>
        <h2 className={TITLE}>This Session defines a Spec.</h2>
        <p className={SAYS}>
          Start one from this conversation, or join a draft another Session is writing.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={onCreate}>
            <IconPlus size="sm" />
            Create a Spec
          </Button>
          <Button
            // Joining is picking one of the drafts below: the keyboard is taken to them.
            disabled={drafts.length === 0}
            onClick={() => list.current?.querySelector('button')?.focus()}
          >
            Join a Spec
          </Button>
        </div>
        <div className="mt-5 flex flex-col gap-1.5 border-t border-border pt-3">
          <p className={LABEL}>{`Drafts in ${projectName}`}</p>
          {drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No draft to join yet.</p>
          ) : (
            <ul ref={list} aria-label={`Drafts in ${projectName}`}>
              {drafts.map((draft) => (
                <li key={draft.key}>
                  <button type="button" className={DRAFT} onClick={() => onJoin(draft.key)}>
                    <span className={KEY}>{draft.key}</span>
                    <span className={DRAFT_TITLE}>{draft.title}</span>
                    <span className={WRITER}>{`written in « ${draft.writer} »`}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
