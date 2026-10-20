/**
 * Gesture 1, adding a reviewer: what the Reviewers dialog finds people and teams in, once the
 * forge is asked for them. Three ways: the list read once when the dialog opens and searched here
 * (recommended), the whole list ticked, or a handle typed and checked on the forge.
 */
import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { CANDIDATES } from '../../blocks/project-settings/delivery-fixtures.ts'
import { ReviewersForm } from '../../blocks/project-settings/delivery-forms.tsx'
import type { Reviewer } from '../../blocks/project-settings/delivery-model.ts'
import { FixCommand } from '../../blocks/project-settings/provider-forms.tsx'
import { Button, IconButton } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Input } from '../../components/field/field.tsx'
import { Skeleton } from '../../components/loading/loading.tsx'
import {
  IconAlertTriangle,
  IconCheck,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconX,
} from '../../icons.ts'

const LABEL = 'text-sm font-medium'

const BOX = 'flex max-h-dialog flex-col overflow-auto rounded-md border border-border'

const PERSON =
  'flex min-h-control-md min-w-0 items-center gap-2 border-b border-border px-3 text-sm last:border-b-0'

/** A reviewer's name and handle, or a team's handle alone. */
function Who({ reviewer }: { reviewer: Reviewer }): ReactNode {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="truncate">{reviewer.name ?? reviewer.handle}</span>
      {reviewer.name !== undefined && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{reviewer.handle}</span>
      )}
    </span>
  )
}

/** Those chosen, each with its ×, and a mark of its own where the variant has one. */
function Chosen({
  chosen,
  mark,
  onChange,
}: {
  chosen: readonly Reviewer[]
  mark?: ((reviewer: Reviewer) => ReactNode) | undefined
  onChange: (chosen: Reviewer[]) => void
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>
        Chosen <span className="font-normal text-muted-foreground">{chosen.length}</span>
      </span>
      <ul aria-label="Chosen reviewers" className={BOX}>
        {chosen.length === 0 && (
          <li className={cn(PERSON, 'text-muted-foreground')}>Nobody: no review is asked.</li>
        )}
        {chosen.map((one) => (
          <li key={one.handle} className={PERSON}>
            <Who reviewer={one} />
            {mark?.(one)}
            <IconButton
              size="sm"
              variant="ghost"
              icon={<IconX size="sm" />}
              aria-label={`Remove ${one.name ?? one.handle}`}
              onClick={() => onChange(chosen.filter((other) => other.handle !== one.handle))}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Where the list of the forge stands while the dialog is open. */
export type Listing = 'reading' | 'ready' | 'cannot'

/**
 * Recommended: the dialog asks the forge once, as it opens, for everyone who can review the
 * repositories (people with access, and teams), and searches that list as the user types. While
 * it is read, what is typed waits under skeleton rows; when the forge's command line cannot be
 * asked, the trouble and its command are said in the dialog, and a handle can still be added as
 * typed.
 */
export function ListedReviewers({
  listing,
  initialQuery = '',
  initial,
}: {
  listing: Listing
  initialQuery?: string | undefined
  initial: readonly Reviewer[]
}): ReactNode {
  const [chosen, setChosen] = useState<Reviewer[]>([...initial])
  const [query, setQuery] = useState(initialQuery)
  if (listing === 'ready') {
    return <ReviewersForm chosen={chosen} candidates={CANDIDATES} onChange={setChosen} />
  }
  const typed = query.trim()
  return (
    <>
      <Chosen chosen={chosen} onChange={setChosen} />
      {listing === 'cannot' && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-rim p-3">
          <p className="flex items-start gap-2 text-sm">
            <span className="flex shrink-0 pt-0.5 text-warning">
              <IconAlertTriangle size="sm" aria-hidden="true" />
            </span>
            <span className="max-w-measure">
              gh is signed out of github.com: Hemera cannot list who reviews. A handle typed below
              is added as it is.
            </span>
          </p>
          <FixCommand line="gh auth login --hostname github.com" onCopy={() => {}} />
          <div>
            <Button size="sm">
              <IconRefresh size="sm" />
              Check again
            </Button>
          </div>
        </div>
      )}
      <Input
        label="Add a reviewer"
        icon={<IconSearch size="sm" />}
        placeholder={listing === 'cannot' ? 'A handle or a team' : 'A name, a handle or a team'}
        value={query}
        onValueChange={setQuery}
      />
      {typed !== '' && listing === 'reading' && (
        <ul
          aria-label="Reviewers found"
          aria-busy="true"
          className="flex flex-col overflow-hidden rounded-md border border-border"
        >
          {['Mira Okafor', 'Tomas Lindqvist', '@acme/platform'].map((one) => (
            <li key={one} aria-hidden="true" className={PERSON}>
              <Skeleton>{one}</Skeleton>
            </li>
          ))}
        </ul>
      )}
      {typed !== '' && listing === 'cannot' && (
        <ul aria-label="Reviewers found" className={BOX}>
          <li className={PERSON}>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{typed}</span>
            <span className="text-xs text-muted-foreground">as typed</span>
            <IconButton
              size="sm"
              variant="ghost"
              icon={<IconPlus size="sm" />}
              aria-label={`Add ${typed} as typed`}
              onClick={() => {
                setChosen([...chosen, { handle: typed }])
                setQuery('')
              }}
            />
          </li>
        </ul>
      )}
    </>
  )
}

/**
 * The whole list, ticked: the forge's teams, then its people, each with its box, under a filter.
 * Nothing to search for when the list is short; a long one is scrolled.
 */
export function TickedReviewers({ initial }: { initial: readonly Reviewer[] }): ReactNode {
  const [chosen, setChosen] = useState<Reviewer[]>([...initial])
  const [query, setQuery] = useState('')
  const taken = new Set(chosen.map((one) => one.handle))
  const words = query.trim().toLowerCase()
  const shown = CANDIDATES.filter((one) =>
    `${one.handle} ${one.name ?? ''}`.toLowerCase().includes(words),
  )
  const groups = [
    { label: 'Teams', people: shown.filter((one) => one.name === undefined) },
    { label: 'People', people: shown.filter((one) => one.name !== undefined) },
  ]
  const toggle = (one: Reviewer, on: boolean): void =>
    setChosen(on ? [...chosen, one] : chosen.filter((other) => other.handle !== one.handle))
  return (
    <>
      <Input
        label="Filter"
        icon={<IconSearch size="sm" />}
        placeholder="A name, a handle or a team"
        value={query}
        onValueChange={setQuery}
      />
      <div className={cn(BOX, 'max-h-dialog')}>
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col">
            <h3 className="flex h-control-sm shrink-0 items-center border-b border-border bg-surface-rim px-3 text-xs text-muted-foreground">
              {group.label}{' '}
              <span className="ml-1">
                {group.people.filter((one) => taken.has(one.handle)).length}
              </span>
            </h3>
            <ul aria-label={group.label} className="flex flex-col">
              {group.people.map((one) => (
                <li key={one.handle} className={PERSON}>
                  <Checkbox
                    checked={taken.has(one.handle)}
                    onCheckedChange={(on) => toggle(one, on)}
                    label={<Who reviewer={one} />}
                    hiddenLabel={one.name === undefined ? undefined : one.handle}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  )
}

/** A typed handle, as the forge answers for it. */
export type Checked = 'checking' | 'found' | 'unknown'

/**
 * A handle typed and added: the forge is asked whether it names someone (`gh api users/<handle>`,
 * or the team), and the line says what it answered — the person's name, or that nobody is called
 * so. No list is read; nothing is offered while typing.
 */
export function TypedReviewers({
  initial,
  checks,
  initialQuery = '',
}: {
  initial: readonly Reviewer[]
  /** What the forge answered for each chosen handle; absent: found. */
  checks: Readonly<Partial<Record<string, Checked>>>
  initialQuery?: string | undefined
}): ReactNode {
  const [chosen, setChosen] = useState<Reviewer[]>([...initial])
  const [query, setQuery] = useState(initialQuery)
  const unknown = chosen.filter((one) => checks[one.handle] === 'unknown')
  const mark = (one: Reviewer): ReactNode => {
    const state = checks[one.handle] ?? 'found'
    if (state === 'checking') {
      return (
        <span className="text-xs text-muted-foreground">
          <Skeleton>Checking</Skeleton>
        </span>
      )
    }
    if (state === 'unknown') {
      return (
        <span className="flex text-destructive">
          <IconAlertTriangle size="sm" aria-label="Nobody on github.com" />
        </span>
      )
    }
    return (
      <span className="flex text-success">
        <IconCheck size="sm" aria-label="Found on github.com" />
      </span>
    )
  }
  return (
    <>
      <Chosen chosen={chosen} mark={mark} onChange={setChosen} />
      {unknown.map((one) => (
        <p key={one.handle} role="alert" className="text-sm text-destructive-muted-foreground">
          Nobody is called {one.handle} on github.com.
        </p>
      ))}
      <Input
        label="Add a reviewer"
        placeholder="A handle, or @org/team"
        value={query}
        onValueChange={setQuery}
        action={
          <Button
            size="sm"
            disabled={query.trim() === ''}
            onClick={() => {
              setChosen([...chosen, { handle: query.trim() }])
              setQuery('')
            }}
          >
            Add
          </Button>
        }
      />
    </>
  )
}
