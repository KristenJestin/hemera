import { type ReactNode, useEffect, useRef, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { IconEye, IconLock } from '../icons.ts'
import { AgentText } from '../message/agent-text.tsx'
import { ConflictBanner } from './conflict-banner.tsx'
import { InPlaceText } from './in-place-text.tsx'
import { SECTION_TITLES, type SectionView } from './model.ts'
import { PartHead } from './part-head.tsx'

/**
 * One section of the Spec document, edited where it is read (lot 19, brief revision 2; D7-12).
 *
 * The text is the editor: it looks like the rendered text until the caret is in it, and it is
 * saved when the caret leaves. A save by you is written with your provenance and goes to the
 * agent with its next turn, which the facts beside the heading say in so many words. The eye at
 * the end of them shows the Markdown rendered, for the paragraph with a list or a code span.
 *
 * A section that is not editable — a `ready` Spec, an older revision — is drawn as the text it
 * is, with a lock among the facts and no editing look at all. A section in conflict keeps your
 * text in the editor and says so in a banner inside the section; nothing of yours is lost.
 */

const NOTE = 'mt-1 text-xs text-muted-foreground'

const THEIRS = 'flex flex-col gap-1 rounded-md border border-border bg-surface-body px-3 py-2'

const THEIRS_HEAD = 'text-xs font-medium text-muted-foreground'

const WARN = 'text-warning-muted-foreground'

export interface SectionPartProps {
  section: SectionView
  /** Whether the text can be changed: a draft, at its current revision. */
  editable: boolean
  /**
   * Your text, once, when the caret leaves it changed, with the version of the section the edit
   * was opened on: an agent may have written it meanwhile, and a save checked against the version
   * on screen by then would be last-writer-wins (D7-12).
   */
  onSave: (body: string, baseVersion: number) => void
  /** Writes your text of a conflict on top of the current version. */
  onApplyMine: (body: string) => void
  /** Lets your text of a conflict go. */
  onDiscardMine: () => void
}

export function SectionPart({
  section,
  editable,
  onSave,
  onApplyMine,
  onDiscardMine,
}: SectionPartProps): ReactNode {
  const [previewing, setPreviewing] = useState(false)
  const [saves, setSaves] = useState(0)
  const [comparing, setComparing] = useState(false)
  // The version the caret found the section at, noted when it goes in and never after.
  const openedOn = useRef(section.version)
  const conflict = section.conflict
  // Your text of a conflict is held here while you keep editing it: saving it would only
  // conflict again, so it is handed over by `Apply mine` and by nothing else.
  const [mine, setMine] = useState(conflict?.mine ?? '')
  useEffect(() => {
    setMine(conflict?.mine ?? '')
  }, [conflict?.mine])
  const title = SECTION_TITLES[section.name]
  const reading = !editable || previewing
  return (
    <div className="flex flex-col gap-1.5">
      <PartHead
        title={title}
        mark={section.mark}
        facts={factsOf(section, editable)}
        saves={saves}
        end={
          editable && conflict === undefined ? (
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconEye size="sm" />}
              aria-label={`Preview ${title} as Markdown`}
              aria-pressed={previewing}
              onClick={() => setPreviewing(!previewing)}
            />
          ) : undefined
        }
      />
      {conflict !== undefined && editable ? (
        <>
          <ConflictBanner
            comparing={comparing}
            onCompare={() => setComparing(!comparing)}
            onApply={() => onApplyMine(mine)}
            onDiscard={onDiscardMine}
          />
          {comparing && (
            <div className={THEIRS}>
              <p className={THEIRS_HEAD}>The agent's text</p>
              <AgentText text={conflict.theirs} />
            </div>
          )}
          <InPlaceText label={`${title}, your text`} value={mine} onCommit={setMine} rows={4} />
        </>
      ) : reading ? (
        section.body === '' ? (
          <p className="text-sm text-muted-foreground">Nothing written yet.</p>
        ) : (
          <AgentText text={section.body} />
        )
      ) : (
        <InPlaceText
          label={title}
          value={section.body}
          rows={2}
          placeholder="Nothing written yet. Write it here, or let the agent."
          onStart={() => {
            openedOn.current = section.version
          }}
          onCommit={(body) => {
            onSave(body, openedOn.current)
            setSaves(saves + 1)
          }}
        />
      )}
      {section.note !== undefined && <p className={NOTE}>{section.note}</p>}
    </div>
  )
}

/**
 * What the facts say of a section, in the reader's words: `you` when you wrote it last and
 * nothing when the agent did, and what is about to happen. No version and no revision: those are
 * the engine's bookkeeping, not something the reader acts on.
 */
function factsOf(section: SectionView, editable: boolean): ReactNode[] {
  const yours: ReactNode[] = section.author === 'human' ? ['you'] : []
  if (section.conflict !== undefined && editable) return ['you', 'not saved']
  if (!editable) {
    return [
      ...yours,
      <span key="lock" className="flex items-center gap-1">
        <IconLock size="sm" />
        frozen
      </span>,
    ]
  }
  if (section.author === null) return section.mark === 'writing' ? ['writing…'] : ['empty']
  if (section.copiedFrom !== undefined) {
    return [
      ...yours,
      <span key="stale" className={WARN}>
        to review
      </span>,
    ]
  }
  if (section.mark === 'writing') return [...yours, 'writing…']
  if (section.pendingForAgent === true) return [...yours, 'sent to the agent next turn']
  return yours
}
