import { type ReactNode, useEffect, useRef, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { Frame, FrameFooter } from '../components/frame/frame.tsx'
import { IconAt, IconPaperclip } from '../icons.ts'
import { ComposerActions } from './composer-actions.tsx'
import { ComposerAttachments } from './composer-attachments.tsx'
import { ComposerBox, type ComposerBoxHandle } from './composer-box.tsx'
import { MentionMenu } from './mention-menu.tsx'
import { PromptInput, type PromptShape } from './prompt-input.tsx'

/**
 * The composer: what a Session is started from, and what is written into one (design D4b-02,
 * D4-08).
 *
 * A `Frame`, and the one frame whose rim comes and goes. The body is the prompt input — the
 * box, its shape and the keys that end a sentence — the Workspace and the actions stay open in
 * the rim below it, and the files attached appear open in the rim above it the moment there is
 * one.
 *
 * Nothing inside animates a height. The frame carries `layout`, the header enters in opacity
 * and travel, and motion plays the difference between the two frames as a transform: the box
 * and the footer slide down as the header appears, which is the movement the prototype earned.
 *
 * What is written and what is attached belong to the page, and so does the write: `onSend`
 * answers with the reason a message could not be recorded, or with nothing when it was. A
 * refusal leaves the sentence exactly where it was — a sentence that could not be written is
 * the one thing a hand must not have to type twice. A write that went through empties the box
 * and the files that went with it and puts the caret back, because a box that kept what it had
 * just sent would have to be cleared by every page that uses it, and one of them would forget.
 */
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
  /**
   * The files attached so far, as the paths they were handed over by: relative to the folder of
   * the Workspace, or absolute for a file chosen outside it, which the clip allows.
   */
  files: string[]
  onFilesChange: (files: string[]) => void
  /** Asks for the files of the Project that match what has been typed after the `@`. */
  onSearchFiles: (query: string) => Promise<string[]>
  /**
   * Asks the system for files to attach, and answers what was chosen.
   *
   * The clip is not the `@`: one names a file of the Project in the sentence, the other opens
   * the window the desktop opens for choosing files — any file, anywhere on the machine, which
   * is the whole point of it — and answers them by the paths they are named by there. Absent,
   * the clip falls back to the same list as the `@`, which is what a catalogue with no disk
   * behind it has.
   */
  onPickFiles?: (() => Promise<string[]>) | undefined
  /** The Workspaces on offer; this lot has one, and lot 7 brings the others. */
  workspaces?: string[] | undefined
  workspace?: string | undefined
  onWorkspaceChange?: ((workspace: string) => void) | undefined
  /** The word on the button that sends: `Start chat` on the Home. */
  action?: string | undefined
  /** The shape of the box: the Home's greeting, or the foot of a Session. */
  variant?: PromptShape | undefined
  placeholder?: string | undefined
  /** Writes the text, and answers why it could not be written, or nothing when it was. */
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
  variant = 'hero',
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

  /** Whether there is anything to send, which Enter and the button both ask. */
  const ready = value.trim() !== '' && !sending

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
   * The window is opened over the whole machine and not over the Workspace: the `@` is how a
   * file of the Project is named, and a clip that could only reach inside one folder would be
   * the `@` with an extra step. What comes back outside the Workspace is named by its own
   * absolute path, since that is the only name it has.
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

  /** Writes what is written, and lets the box go when it has been written. */
  const send = async () => {
    if (!ready) return
    setSending(true)
    const said = await onSend(value)
    setSending(false)
    setRefusal(said)
    if (said !== null) return
    onValueChange('')
    onFilesChange([])
    box.current?.focus()
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

  /**
   * The clip: one press, one window.
   *
   * The same button either way — the system's window where the application has one, the list of
   * the Project where it does not — and never both at once. A window opening under a list that
   * the same press had just opened is what made one control look like two.
   */
  const clip = (
    <IconButton
      variant="ghost"
      size="sm"
      icon={<IconPaperclip size="sm" />}
      aria-label="Attach a file"
      onClick={() => void pick()}
    />
  )

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
              ready={ready}
              sending={sending}
              action={action}
              onSend={() => void send()}
            />
          </FrameFooter>
        }
      >
        <PromptInput
          variant={variant}
          ready={ready}
          onSend={() => void send()}
          tools={
            <>
              {/* Two ways to the same files, and what tells them apart is what else happens.
                  A mention is named in the sentence and nothing more; an attachment is named
                  there too and handed along with the message, which is what the header above
                  the box holds. The paperclip is not a list where the application can answer
                  it: it opens the system's own window, over any folder on the machine, and a
                  list opening on top of that window was one gesture answering twice. The list
                  is what a catalogue with no disk behind it has. */}
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
              {onPickFiles === undefined ? (
                <MentionMenu
                  open={picking === 'attach'}
                  onOpenChange={(next) => setPicking(next ? 'attach' : null)}
                  files={matches}
                  activeIndex={active}
                  onActiveIndexChange={setActive}
                  onChoose={attach}
                  hint="Attach a file of the Project…"
                  trigger={clip}
                />
              ) : (
                clip
              )}
            </>
          }
        >
          <ComposerBox
            handle={box}
            value={value}
            placeholder={placeholder}
            onValueChange={typed}
            onKeyDown={(event) => {
              // The list open over the box reads the arrows and Enter, and says so by taking the
              // key: the prompt input one band up reads what is left. Enter sends, Shift+Enter
              // breaks the line, and an IME mid-word is left alone.
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
                }
              }
            }}
          />
        </PromptInput>
      </Frame>

      {refusal !== null && (
        <p role="alert" className="text-sm text-muted-foreground">
          {refusal}
        </p>
      )}
    </div>
  )
}
