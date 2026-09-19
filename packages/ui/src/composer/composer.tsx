import { type ReactNode, useEffect, useRef, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { Frame, FrameFooter } from '../components/frame/frame.tsx'
import { IconAt, IconPaperclip } from '../icons.ts'
import { ComposerActions } from './composer-actions.tsx'
import { ComposerAttachments } from './composer-attachments.tsx'
import { ComposerBox, type ComposerBoxHandle } from './composer-box.tsx'
import { MentionMenu } from './mention-menu.tsx'

/**
 * The composer: what a Session is started from, complete and inert in this lot (D4-07, D4-08).
 *
 * A `Frame`, and the one frame whose rim comes and goes. The box is the body — where the caret
 * is, the border and the ring — the Workspace and the actions stay open in the rim below it,
 * and the files attached appear open in the rim above it the moment there is one.
 *
 * Nothing inside animates a height. The frame carries `layout`, the header enters in opacity
 * and travel, and motion plays the difference between the two frames as a transform: the box
 * and the footer slide down as the header appears, which is the movement the prototype earned.
 *
 * The box itself grows with the text, from two lines to eight, and stops there. That is the
 * browser's own `field-sizing`, not an animation: a box that eased its way to a new height
 * would be a box lagging behind the sentence being typed into it.
 */
const BOX = 'flex flex-col gap-1 px-4 pt-3 pb-2'

const TOOLS = 'flex items-center gap-1'

/** What `@` is written as, and what the composer looks for behind the caret. */
const MENTION = /@([\w./-]*)$/

/** How long the typing has to stop before the files of the Workspace are asked for. */
const SETTLING = 250

/** Which of the two lists is open: the one that writes a mention, or the one that attaches. */
type Picking = 'mention' | 'attach' | null

export interface ComposerProps {
  /** What is written, held by the caller so a page can keep it across a refusal. */
  value: string
  onValueChange: (value: string) => void
  /** The files attached so far, as paths relative to the folder of the Workspace. */
  files: string[]
  onFilesChange: (files: string[]) => void
  /** Asks for the files of the Project that match what has been typed after the `@`. */
  onSearchFiles: (query: string) => Promise<string[]>
  /**
   * Asks the system for files to attach, and answers what was chosen.
   *
   * The clip is not the `@`: one names a file in the sentence from what the Project holds, the
   * other opens the window the desktop opens for choosing files, several at a time. Absent, the
   * clip falls back to the same list as the `@` — which is what Storybook has, having no system
   * to ask.
   */
  onPickFiles?: (() => Promise<string[]>) | undefined
  /** The Workspaces on offer; this lot has one, and lot 7 brings the others. */
  workspaces?: string[] | undefined
  workspace?: string | undefined
  onWorkspaceChange?: ((workspace: string) => void) | undefined
  /** The word on the button that sends: `Start chat` on the Home. */
  action?: string | undefined
  placeholder?: string | undefined
  /** What is done with the text; the message it answers is shown under the frame. */
  onSend: (text: string) => Promise<string | null>
}

export function Composer({
  value,
  onValueChange,
  files,
  onFilesChange,
  onSearchFiles,
  onPickFiles,
  workspaces = ['main'],
  workspace,
  onWorkspaceChange,
  action = 'Start chat',
  placeholder = 'Ask anything, think out loud, or describe what you want to do…',
  onSend,
}: ComposerProps): ReactNode {
  const box = useRef<ComposerBoxHandle>(null)
  const [matches, setMatches] = useState<string[]>([])
  const [picking, setPicking] = useState<Picking>(null)
  const [active, setActive] = useState(0)
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [chosen, setChosen] = useState(workspaces[0] ?? 'main')
  const current = workspace ?? chosen

  /**
   * Asks for the files matching what has been typed, once the typing has stopped.
   *
   * A Workspace is a folder of someone else's making, and every one of these questions walks it
   * — up to two thousand entries — so one per character is a disk read per keystroke and a menu
   * that lags behind the caret. A quarter of a second of quiet is what tells a word being typed
   * from a word that has been.
   *
   * And the answers are numbered. They come back in whatever order a disk hands them over, and
   * the one that matters is the one to the last question: without the count, a slow answer about
   * `pfm` lands over the answer about `pfm-palbank` and the list stops agreeing with the box.
   */
  const asked = useRef(0)
  const settling = useRef<ReturnType<typeof setTimeout>>(undefined)

  const search = (which: Picking, query: string) => {
    setPicking(which)
    clearTimeout(settling.current)
    const mine = asked.current + 1
    asked.current = mine
    settling.current = setTimeout(() => {
      void onSearchFiles(query).then((found) => {
        if (asked.current !== mine) return
        setMatches(found)
        setActive(0)
      })
    }, SETTLING)
  }

  useEffect(() => () => clearTimeout(settling.current), [])

  /**
   * Takes the `@…` that asked for the list back out, so the chip replaces it rather than
   * following it. Selecting backwards over exactly what was typed is the only way to do it:
   * the box owns its own content, and rewriting the whole sentence around the caret is what
   * would throw the caret away.
   */
  const eatQuery = () => {
    const found = MENTION.exec(box.current?.textBeforeCaret() ?? '')
    if (found === null) return
    const selection = document.getSelection()
    if (selection?.rangeCount === 1) {
      const range = selection.getRangeAt(0)
      for (let step = 0; step < found[0].length; step += 1)
        selection.modify('extend', 'backward', 'character')
      if (range.toString() === found[0]) range.deleteContents()
    }
  }

  /** Names the file in the sentence, as a chip, where the caret is. */
  const mention = (file: string) => {
    eatQuery()
    box.current?.insertFile(file, 'mention')
    setPicking(null)
  }

  /**
   * Attaches the file, which puts it in two places on purpose.
   *
   * In the header, because that is what is sent along with the message; and in the sentence,
   * because a file attached from the middle of a question is a file the question is about. The
   * two are one gesture and read as one.
   */
  const attach = (file: string) => {
    if (!files.includes(file)) onFilesChange([...files, file])
    box.current?.insertFile(file, 'file')
    setPicking(null)
  }

  /**
   * Attaches whatever the system's own window was used to choose, all of it at once.
   *
   * The header is told once, with everything that was chosen. Told one file at a time it would
   * be told each of them against the list this render was given — so three files picked
   * together arrived as one, the last, and the other two were named in the sentence and
   * attached to nothing.
   */
  const pick = async () => {
    if (onPickFiles === undefined) {
      search('attach', '')
      return
    }
    const picked = await onPickFiles()
    const added = [...new Set(picked)].filter((file) => !files.includes(file))
    if (added.length > 0) onFilesChange([...files, ...added])
    for (const file of picked) box.current?.insertFile(file, 'file')
    setPicking(null)
  }

  const send = async () => {
    setSending(true)
    const said = await onSend(value)
    setSending(false)
    setRefusal(said)
  }

  const typed = (next: string) => {
    onValueChange(next)
    setRefusal(null)
    // What is behind the caret is what is being written, which is what the list answers: a `@`
    // three words back is a mention already made and not a question being asked.
    const found = MENTION.exec(box.current?.textBeforeCaret() ?? '')
    if (found === null) {
      if (picking === 'mention') setPicking(null)
    } else search('mention', found[1] ?? '')
  }

  return (
    <div className="flex flex-col gap-2">
      <Frame
        animated
        focusable
        header={
          <ComposerAttachments
            files={files}
            onRemove={(file) => onFilesChange(files.filter((one) => one !== file))}
            onClear={() => onFilesChange([])}
          />
        }
        footer={
          <FrameFooter>
            <ComposerActions
              workspaces={workspaces}
              workspace={current}
              onWorkspaceChange={(next) => {
                setChosen(next)
                onWorkspaceChange?.(next)
              }}
              ready={value.trim() !== '' && !sending}
              sending={sending}
              action={action}
              onSend={() => void send()}
            />
          </FrameFooter>
        }
      >
        <div className={BOX}>
          <ComposerBox
            handle={box}
            value={value}
            placeholder={placeholder}
            onValueChange={typed}
            onKeyDown={(event) => {
              if (picking !== null && matches.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActive((active + 1) % matches.length)
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive((active - 1 + matches.length) % matches.length)
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  const file = matches[active]
                  if (file !== undefined) (picking === 'attach' ? attach : mention)(file)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setPicking(null)
                  return
                }
              }
              // Enter sends and Shift+Enter breaks the line, which is what every box of this
              // shape does and what the hand already expects of this one.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (value.trim() !== '') void send()
              }
            }}
          />

          <div className={TOOLS}>
            {/* Two ways to the same files, and what tells them apart is what else happens.
                A mention is named in the sentence and nothing more; an attachment is named
                there too and handed along with the message, which is what the header above the
                box holds. In the application the paperclip opens the system's file dialog
                rather than this list — the list is what a catalogue with no disk behind it can
                offer, and what it does with the answer is the same either way. Lot 7 gives it
                the dialog. */}
            <MentionMenu
              open={picking === 'mention'}
              onOpenChange={(next) => setPicking(next ? 'mention' : null)}
              files={matches}
              activeIndex={active}
              onActiveIndexChange={setActive}
              onChoose={mention}
              trigger={
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconAt size="sm" />}
                  aria-label="Mention a file of the Project"
                  onClick={() => {
                    // The `@` goes in where the caret is, so what is typed next narrows the
                    // list exactly as it does when the `@` was typed by hand.
                    box.current?.insertText('@')
                    search('mention', '')
                  }}
                />
              }
            />
            <MentionMenu
              open={picking === 'attach'}
              onOpenChange={(next) => setPicking(next ? 'attach' : null)}
              files={matches}
              activeIndex={active}
              onActiveIndexChange={setActive}
              onChoose={attach}
              hint="Attach a file of the Project…"
              trigger={
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconPaperclip size="sm" />}
                  aria-label="Attach a file of the Project"
                  onClick={() => void pick()}
                />
              }
            />
          </div>
        </div>
      </Frame>

      {refusal !== null && (
        <p role="alert" className="text-sm text-muted-foreground">
          {refusal}
        </p>
      )}
    </div>
  )
}
