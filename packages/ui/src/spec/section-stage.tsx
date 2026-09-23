import { type ReactNode, useEffect, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { IconEye, IconLock } from '../icons.ts'
import { AgentText } from '../message/agent-text.tsx'
import { ConflictBanner } from './conflict-banner.tsx'
import { InPlaceText } from './in-place-text.tsx'
import { SECTION_TITLES, type SectionView } from './model.ts'
import { StageHead } from './stage-head.tsx'

/**
 * One section on the stage, edited where it is read (lot 19, brief "Stage"; D7-12).
 *
 * The text is the editor: it looks like the rendered text until the caret is in it, and it is
 * saved when the caret leaves. A save by you is written with your provenance and goes to the
 * agent with its next turn, which the meta line says in so many words. The eye at the end of
 * that line shows the Markdown rendered, for the paragraph with a list or a code span in it.
 *
 * A section that is not editable — a `ready` Spec, an older revision — is drawn as the text it
 * is, with a lock in the meta line and no editing look at all. A section in conflict keeps your
 * text in the editor and says so in a banner inside the section; nothing of yours is lost.
 */

const NOTE = 'mt-2.5 text-xs text-muted-foreground'

const THEIRS = 'flex flex-col gap-1 rounded-md border border-border bg-surface-body px-3 py-2'

const THEIRS_HEAD = 'text-xs font-medium text-muted-foreground'

const WARN = 'text-warning-muted-foreground'

export interface SectionStageProps {
  section: SectionView
  /** Whether the text can be changed: a draft, at its current revision. */
  editable: boolean
  /** The revision shown, which the meta line of a frozen section names. */
  revision: number
  /** Your text, once, when the caret leaves it changed. */
  onSave: (body: string) => void
  /** Writes your text of a conflict on top of the current version. */
  onApplyMine: (body: string) => void
  /** Lets your text of a conflict go. */
  onDiscardMine: () => void
}

export function SectionStage({
  section,
  editable,
  revision,
  onSave,
  onApplyMine,
  onDiscardMine,
}: SectionStageProps): ReactNode {
  const [previewing, setPreviewing] = useState(false)
  const [saves, setSaves] = useState(0)
  const [comparing, setComparing] = useState(false)
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
    <div className="flex flex-col gap-2">
      <StageHead
        title={title}
        facts={factsOf(section, editable, revision)}
        saves={saves}
        end={
          editable && conflict === undefined ? (
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconEye size="sm" />}
              aria-label="Preview the Markdown"
              aria-pressed={previewing}
              onClick={() => setPreviewing(!previewing)}
            />
          ) : undefined
        }
      />
      {conflict !== undefined && editable ? (
        <>
          <ConflictBanner
            base={conflict.base}
            current={conflict.current}
            comparing={comparing}
            onCompare={() => setComparing(!comparing)}
            onApply={() => onApplyMine(mine)}
            onDiscard={onDiscardMine}
          />
          {comparing && (
            <div className={THEIRS}>
              <p className={THEIRS_HEAD}>{`v${conflict.current} · agent`}</p>
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
          rows={3}
          placeholder="Nothing written yet. Write it here, or let the agent."
          onCommit={(body) => {
            onSave(body)
            setSaves(saves + 1)
          }}
        />
      )}
      {section.note !== undefined && <p className={NOTE}>{section.note}</p>}
    </div>
  )
}

/** What the meta line says of a section: who, which version, and what is about to happen. */
function factsOf(section: SectionView, editable: boolean, revision: number): ReactNode[] {
  const who = section.author === 'human' ? 'you' : 'agent'
  if (section.conflict !== undefined && editable) {
    return ['you', `written on v${section.conflict.base}`, 'not saved']
  }
  if (!editable) {
    return [
      <span key="lock" className="flex items-center gap-1">
        <IconLock size="sm" />
        {who}
      </span>,
      `rev ${revision}`,
      'frozen',
    ]
  }
  if (section.author === null) {
    return section.mark === 'writing' ? ['agent', 'writing'] : ['not written yet']
  }
  if (section.copiedFrom !== undefined) {
    return [
      who,
      `copied from rev ${section.copiedFrom}`,
      <span key="stale" className={WARN}>
        stale after the rework
      </span>,
    ]
  }
  if (section.mark === 'writing') return [who, `v${section.version}`, 'writing']
  if (section.pendingForAgent === true) {
    return [who, `v${section.version}`, 'sent to the agent next turn']
  }
  return [who, `v${section.version}`]
}
