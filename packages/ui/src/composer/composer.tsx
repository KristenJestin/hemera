import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { Frame, FrameFooter } from '../components/frame/frame.tsx'
import { IconAt, IconPaperclip } from '../icons.ts'
import { ComposerActions } from './composer-actions.tsx'
import { ComposerAttachments } from './composer-attachments.tsx'
import { ComposerBox, type ComposerBoxHandle } from './composer-box.tsx'
import { MentionMenu, mentionOptionId } from './mention-menu.tsx'
import { PromptInput, type PromptShape } from './prompt-input.tsx'
import type { WorkspaceChoice } from './workspace-pill.tsx'

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
  /** The Workspaces in state `ready`, `main` first, filtered and ordered by the caller (D8-08). */
  workspaces?: WorkspaceChoice[] | undefined
  workspace?: string | undefined
  onWorkspaceChange?: ((workspace: string) => void) | undefined
  /** Whether the agent has started, which fixes the Workspace (D8-08). */
  workspaceFixed?: boolean | undefined
  /** The word on the button that sends: `Start chat` on the Home. */
  action?: string | undefined
  /**
   * Why the send cannot be pressed, said on the control itself (design D4b-02).
   *
   * The Home's composer starts a Session, and a Session is made with the agent it will run: with
   * no agent chosen there is nothing to make and nobody to answer. The reason used to be a
   * paragraph above the box, which pushed the whole frame down the moment it appeared and left a
   * gap the moment it went; it belongs on the control it is about, where a hand that stops on it
   * is told why and nothing moves at all.
   */
  sendDisabledReason?: string | undefined
  /** The shape of the box: the Home's greeting, or the foot of a Session. */
  variant?: PromptShape | undefined
  placeholder?: string | undefined
  /** Writes the text, and answers why it could not be written, or nothing when it was. */
  onSend: (text: string) => Promise<string | null>
  /**
   * The one control for the agent, its model, its effort and its mode, at the end of the box's
   * own row (design D17-11).
   *
   * It is handed over already built, because what an agent announced is what the engine
   * answered rather than something this composer could know. It sits *inside* the frame, on the
   * row the `@` and the paperclip are on, and not in the foot: the foot used to hold the
   * agent's controls beside the actions, they wrapped onto a second line as soon as a model had
   * a long name, and the frame changed height while it was being read.
   *
   * There is no second slot for the mode since the trial of 22 September 2026. The mode is one
   * of the four things the agent is set on, it is a row of that same panel, and two controls
   * side by side asking about one agent was one control too many in a row that must not wrap.
   */
  agentMenu?: ReactNode | undefined
  /**
   * Whether the foot offers to turn what is written into a Spec (design D4b-02).
   *
   * The Home does and a Session does not: a Session is a conversation that is already under
   * way, and a Spec is made from the question that starts one. Off unless the page asks for it,
   * so the control has to be earned rather than removed.
   */
  spec?: boolean | undefined
  /**
   * Whether a turn is running, which is what the send becomes while it does (design D17-13).
   *
   * It is not the same question as `sending`: a write is in flight for as long as the engine
   * takes to take it, and a turn runs for minutes. A stop offered during a write would be a
   * stop offered before there is anything to stop.
   */
  running?: boolean | undefined
  /** Cancels the running turn, when there is one. */
  onStop?: (() => void) | undefined
  /**
   * What the turn is waiting on, drawn above the box (design D5-13).
   *
   * A permission is the one thing that makes this box a place to read rather than a place to
   * write, and it is built by whoever knows what is being asked: the strip is handed over
   * already written, and the composer only gives it the room.
   */
  blocked?: ReactNode | undefined
}

export function Composer({
  value,
  onValueChange,
  files,
  onFilesChange,
  onSearchFiles,
  onPickFiles,
  workspaces = [{ name: 'main' }],
  workspace,
  onWorkspaceChange,
  workspaceFixed = false,
  action = 'Start chat',
  sendDisabledReason,
  variant = 'hero',
  placeholder = 'Ask anything, think out loud, or describe what you want to do…',
  onSend,
  agentMenu,
  spec = false,
  running = false,
  onStop,
  blocked,
}: ComposerProps): ReactNode {
  const box = useRef<ComposerBoxHandle>(null)
  const [matches, setMatches] = useState<string[]>([])
  const [picking, setPicking] = useState<Picking>(null)
  const [active, setActive] = useState(0)
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  /**
   * Whether the Stop was pressed during the turn that is running (design D5-10).
   *
   * The first press asks the agent to cancel and the second one forces it: the control says
   * "Force stop" in between. A turn that ended takes the press with it, so the next turn starts
   * on a plain Stop — reset while rendering rather than in an effect, so the word never lags.
   */
  const [stopPressed, setStopPressed] = useState(false)
  if (!running && stopPressed) setStopPressed(false)
  const [chosen, setChosen] = useState(workspaces[0]?.name ?? 'main')
  const current = workspace ?? chosen
  // What names the entries of the mention band, so the box can point at the one the arrows are
  // on: the band takes no focus, and this is the only thing that tells a reader who cannot see
  // it which file Enter would put in. Two composers on one page are two sets of names.
  const mentions = useId()

  /**
   * Whether there is anything to send, which Enter and the button both ask.
   *
   * `sendDisabledReason` is part of the answer: a sentence with nothing behind it to send it to
   * is a sentence that would be written into a Session that cannot answer, and the reason it is
   * off is on the control itself while it is.
   */
  const ready = value.trim() !== '' && !sending && sendDisabledReason === undefined

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

  /** Stops the running turn: the button and Escape from the box are the same press. */
  const stop = () => {
    setStopPressed(true)
    onStop?.()
  }

  /**
   * Writes what is written, and lets the box go when it has been written.
   *
   * Not while a turn runs: the box stays open so the next message can be typed, but the agent is
   * busy with this one, and Enter keeps the sentence where it is rather than sending it into a
   * turn that would refuse it.
   */
  const send = async () => {
    if (!ready || running) return
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
      {blocked}
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
              workspaceFixed={workspaceFixed}
              onWorkspaceChange={(next) => {
                setChosen(next)
                onWorkspaceChange?.(next)
              }}
              ready={ready}
              sending={sending}
              running={running}
              forcing={stopPressed}
              spec={spec}
              action={action}
              onSend={() => void send()}
              onStop={stop}
              sendDisabledReason={sendDisabledReason}
            />
          </FrameFooter>
        }
      >
        <PromptInput
          variant={variant}
          ready={ready}
          onSend={() => void send()}
          // The list of files is a band of the frame, under the text and over the row of tools,
          // and the row is pushed down while it is open. A popup anchored to the `@` covered the
          // thread the sentence was answering — the one thing the reader is looking at while
          // they type. One band for both ways in: what tells a mention from an attachment is
          // what else happens when one is chosen, not which list it came from, and two lists
          // drawn in one place would be two bands fighting over it.
          menu={
            <MentionMenu
              open={picking !== null}
              files={matches}
              activeIndex={active}
              onActiveIndexChange={setActive}
              onChoose={picking === 'attach' ? attach : mention}
              hint={
                picking === 'attach' ? 'Attach a file of the Project…' : 'A file of the Project…'
              }
              optionId={mentions}
            />
          }
          tools={
            <>
              {/* Two ways to the same files, and what tells them apart is what else happens.
                  A mention is named in the sentence and nothing more; an attachment is named
                  there too and handed along with the message, which is what the header above
                  the box holds. The paperclip is not a list where the application can answer
                  it: it opens the system's own window, over any folder on the machine, and a
                  list opening on top of that window was one gesture answering twice. The list
                  is what a catalogue with no disk behind it has. */}
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
              {clip}
              {/* The agent, its model, its effort and its mode, at the end of the same row:
                  they belong to what the box is about, not to what is done with what it holds,
                  and the foot below is the Workspace and the send alone. Pushed to the end
                  rather than wrapped to a line of their own — the height of the frame must not
                  change when a choice is made. */}
              {agentMenu !== undefined && (
                <span className="ml-auto flex min-w-0 items-center gap-1">{agentMenu}</span>
              )}
            </>
          }
        >
          <ComposerBox
            handle={box}
            value={value}
            placeholder={placeholder}
            // Which file the band is on, while there is a band: the caret never leaves the box,
            // so the box is what has to name it.
            activeDescendant={
              picking !== null && matches[active] !== undefined
                ? mentionOptionId(mentions, active)
                : undefined
            }
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
                  return
                }
              }
              // Escape with no list open is the Stop, from where the hands already are.
              if (event.key === 'Escape' && picking === null && running && onStop !== undefined) {
                event.preventDefault()
                stop()
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
