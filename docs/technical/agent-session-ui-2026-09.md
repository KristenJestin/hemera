# UI surface of a Session with an agent — research of 16 September 2026

Date: 2026-09-16. Scope: the screen that follows "Free sessions", that is, the one where
the user talks to an ACP agent and sees what it does. Goal: gather enough material to
derive an HTML prototype and a list of components from it.

Primary sources consulted on 16 September 2026: the component pages of beui.dev, the
Zed documentation (`zed.dev/docs/ai`), the Claude Code documentation (`code.claude.com/docs`),
the Agent Client Protocol specification (`agentclientprotocol.com`) and the Cursor
and OpenCode documentation. The URLs are listed at the end of the document.

## Summary

> Hemera itself no longer draws that side column: since the second review of #18
> (23 September 2026) the plan, the files, the commands and the context are a **Session
> details** dialog the reader opens from the Session's head, and nothing opens it by itself.

A Session screen is a **chronological thread** in which everything the agent does is a
block, plus a **writing area** at the bottom, plus a **side column** used only for the
things that must stay visible while scrolling: the plan, the summary of touched files,
the current mode. The three reference products converge on this: Zed puts the
thread in the agent panel and moves diff review out into a multi-buffer tab; Claude Code
puts everything in the thread and only moves out the to-do list (`Ctrl+T`) and the detailed
transcript (`Ctrl+O`); Cursor shows the diff live in the editor and keeps the thread for the
conversation.

Three points structure the rest:

1. **The thread is not a list of messages, it is a list of events** — text, thought,
   tool call, diff, terminal output, plan, permission request. ACP already expresses it
   that way: a single `session/update` type with a `sessionUpdate` discriminant.
2. **Tool calls collapse.** Every product observed displays a one-line summary
   (title + status) and opens the content only on demand, except during execution, where
   the block stays open and then closes at the end. beui codes exactly this behaviour via
   `collapseOnComplete`.
3. **A question to the user blocks the turn.** Permission or choice: the thread stops, the
   decision block is the last element, the composer switches to a "waiting" state.

beui covers almost the whole need (message, activity, tool, diff, approval, composer) and
is MIT-licensed, distributed as a shadcn registry. What is missing: live terminal
output, diff review with accept/reject per hunk, the session mode indicator, the
palette of available commands, and the display of a permanent blocking block.

## 1. beui's "agents" components

**Licence and distribution.** Repository `github.com/starc007/ui-components`, MIT licence. The
components are distributed through a shadcn registry under the `@beui` namespace:
`npx shadcn@latest add @beui/<name>` (the pages show `bunx --bun shadcn add @beui/<name>`;
Hemera does not use Bun, so the `npx` or `pnpm dlx` form applies). The README assumes the
"Copy the source, own the code" model: the code lives in the application, not behind a
package. This remains a source of inspiration: the Hemera rule is to write the components
in-house, never to copy the markup.

Common base for all of them: `motion/react`, `lucide-react`, `clsx` + `tailwind-merge` (`cn()`),
`shiki` for highlighting, and shared easing tokens (`EASE_OUT`, `SPRING_PRESS`,
`SPRING_SWAP`, `SPRING_LAYOUT`, `SPRING_PANEL`). All declare that they respect
`prefers-reduced-motion` through a `useReducedMotion` hook.

| Component | Role | States | Animated | Notable props |
|---|---|---|---|---|
| `prompt-input` | Auto-growing composer: textarea, model selector, actions popover, submit/stop button | idle, loading, focus | arrow ↔ square swap (`SPRING_SWAP`), 45° rotation of the `+`, border on focus | `value`, `models`, `actions`, `loading`, `onSubmit`, `minRows`=2, `maxRows`=8 |
| `message` | Row primitives: `Message`, `MessageGroup`, `MessageAvatar`, `MessageContent/Header/Footer`, `MessageMarker`, `MessageTyping` | from user/assistant | entrance opacity 0→1 + `translateY(8px) scale(.95)`, spring 480/32; typing 3 dots, 1.05 s cycle, 0.14 s stagger | `from`, `animateIn`, `spacing` compact/default, `placeholder` |
| `message-bubble` | Bubble surface: `MessageBubble`, `MessageBubbleContent`, `MessageBubbleGroup`, `MessageBubbleCollapsible` | 6 variants `solid/soft/tint/outline/ghost/danger` | pop `scale .92→1` (spring 520/27), content fades in after the surface, chevron + mask on expand | `variant`, `align` start/end, `animateIn`, `collapsedLines` 2–6 (default 4) |
| `message-scroller` | Reader-aware viewport: follows the live edge, releases when scrolling up; optional navigation rail | following / not following | smooth or instant scrolling depending on `smooth` and reduced-motion; rail ticks scaled by proximity to the centre | `followOutput`=true, `followThreshold`=56 px, `smooth`=true, `navigation:"rail"`, `busy`, `onFollowChange`, `viewportClassName` |
| `streaming-response` | Stable response surface: rendered content, end action bar, sources disclosure | `streaming` (with `aria-busy="true"`, no actions), `complete`, `error` | action bar fade + translation (200 ms), button press `scale .9`, sources revealed by `clip-path` | `status`, `copyText`, `sources: CitationItem[]`, `feedback` up/down/null, `announce`=true, `showActions` |
| `citations` | Inline markers + collapsible collection | open/closed | staggered spring appearance, chevron rotation, `popLayout` for reflow | `citations`, `title` (default "Sources"), `defaultOpen`, `onOpenChange`, `idPrefix`; `Citation` takes `citationId`, `index`, `idPrefix` |
| `agent-loading-states` (package `@beui/reasoning-text`) | Three waiting states: `ReasoningText` (rotating phrases + shimmer), `ThinkingShimmer` (discreet shimmer), `AgentProgress` (glyph + verb + timer) | in progress only | character cascade, continuous shimmer, pulsing 3×3 grid, ASCII loader | `phrases`, `variant` cascade/swap/scramble, `interval`=1800 ms, `shimmerDuration`=2.2 s; `label`, `running`, `elapsedSeconds` |
| `todo-list` | Collapsible task plan with counter | per item: pending (dotted circle), in-progress (progress arc + %), completed (filled circle, struck-through text), cancelled (red cross) | morphing of the status marks, arc, strike-through, rolling counter (`ActionSwapRollText`), collapse | `items: TodoItem[]` (id, title, status, progress, detail), `title` (default "To-dos"), `open`/`defaultOpen`, `collapseOnComplete`=true, `maxHeight`=248 |
| `agent-activity` | Adaptive activity stream: reasoning, searches, tool calls, or a chronological mix | `working` (follows the stream by `transform`, gradient mask at the edges), `complete` (scrolling handed back to the user, collapsed) | staggered fades on arrival, vertical offset by transform, chevron, `SPRING_LAYOUT` | `items: AgentActivityItem[]`, `status`, `maxHeight`=208, `collapseOnComplete`=true, `contentType` (default `mixed`), `duration` |
| `tool-result` | Disclosure of a tool execution with highlighted output | `running` (loader, auto-scroll, stays open), `success`, `error`, `cancelled` | rolling-text title, 180° chevron (`SPRING_SWAP`), auto-scroll, press `scale .9`, `clip-path` reveal | `tool`, `title`, `status`, `kind` terminal/request/custom, `copyText`, `onRetry`, `maxHeight`=220, `collapseOnComplete`=true |
| `code-block` | Highlighted code with stable updates | `streaming`, `complete` | auto-scroll in `useLayoutEffect` when the content overflows, loader → check, copy button press | `code`, `language` (bash, diff, json, text, tsx, typescript), `status`, `highlightLines`, `maxHeight`=280, `showLineNumbers`=true, `copyable`=true; Shiki, GitHub light/dark high-contrast themes, cached tokens |
| `file-diff` | Highlighted file diff, progressive lines, live counter | `streaming` (spinner, auto-scroll, open), `complete` (check, collapses) | green/red highlighting per line, smooth scrolling, copy button icon swap (1.6 s) | `file`, `lines: FileDiffLine[]`, `status`, `language`, `maxHeight`=220, `collapseOnComplete`=true, `copyText` |
| `tool-approval` | Permission card: review of the parameters then decision | `pending` (amber), `approving` (blue, loader), `approved`/`complete` (green), `denied`/`error` (red), `running` | spring status transitions, indicator colour | `tool`, `title`, `description`, `parameters` (label/value), `status`, `onApprove`, `onAlwaysAllow`, `onDeny` — that is, "Allow once", "Always allow", "Deny" |
| `approval-card` | Generic decision surface: approval, single- or multiple-choice question, free answer, multi-step flow | `pending`, `submitting`, `approved`, `rejected`, `changes-requested`, `answered` | rolling title, progress dots, sliding questions (`AnimatePresence`), `clip-path` reveal | `questions`, `status`, `onApprove`, `onReject`, `onRequestChanges`, `answers`/`onAnswersChange`, `step`/`onStepChange`, `result` |
| `ai-sidebar` | Workspace sidebar: folders, files, favourites, keyboard navigation, optimistic move, inline rename, marquee labels | collapsed/expanded, drag, inline editing | spring layout, drop targets, morphed popover, marquee, rollback if `onMove` rejects | `items`/`defaultItems`, `onMove`, `onRename`, `activeId`, `defaultExpandedIds`, `renderIcon`/`renderMenu`, `ariaLabel` |
| `chat-app` | Complete assembly: sidebar + scroller + composer + activity + approval + tool + diff + plan + media | — | folds the sidebar off-screen below the threshold | `sidebarWidth` (default `17rem`), `collapseSidebarBelow` (default 600 px) |
| `image-generation` | Generated image surface with progressive refinement | `queued` (heavy blur, opacity 0), `generating`, `refining` (~62%), `complete`, `error` | rotating `DitherMark`, `DitherField` on canvas following the pointer, dither vanishes at the end, "no layout shift" | `status`, `children` (img/video/canvas), `prompt`, `resolution` (default `1024 × 1024`), `interactive`, `onRetry` |

Two internal dependencies come up everywhere and are to be reproduced on Hemera's side:
`AgentDisclosure` (collapsible container animated by `clip-path`/transform, reused by
`todo-list`, `agent-activity`, `tool-result`, `file-diff`, `tool-approval`, `approval-card`,
`citations`) and `ActionSwapRollText` (rolling text swap for titles and counters).
`image-generation` has no use in Hemera.

## 2. How three reference products lay out a session

### Zed — agent panel (ACP end to end)

- **Layout**: the thread is chronological in the agent panel, on the side. The user's
  messages are **editable cards**; the model's responses arrive as a stream. Arrows at the
  bottom of the panel jump to the last prompt or to the start of the thread. External agents
  are hosted in this same panel, plus a "Threads Sidebar" for parallel threads.
- **Tool calls**: "responses arrive with indicators showing which tools the model is
  using". Edits are aggregated in an accordion bar that says **which files, how many, and
  how many lines** changed.
- **Permissions**: calls under permission can be "allowed, denied, or confirmed".
  A model without tool capability carries the "No tools" label; a warning icon
  flags an MCP incompatibility.
- **Diff and acceptance**: either expand the accordion, or click **Review Changes** to
  open a multi-buffer tab with all the modifications; one accepts or rejects **each
  hunk individually, or the whole**. The `agent.single_file_review` setting gives instead
  a single-file inline diff.
- **Going back**: at each edit, a **Restore Checkpoint** button appears.
- **Following**: a crosshair icon makes the editor follow the agent — it jumps to each
  file touched (ACP calls these the `locations` of a tool call).
- **Context**: `@` mentions for files, folders, symbols; a pasted multi-line excerpt
  automatically becomes a context mention.
- Not verified: the list of UI settings (`always_allow_tool_actions`, `expand_edit_card`,
  `notify_when_agent_waiting`…) does not appear on the `agent-settings` page consulted.

### Claude Code — terminal conventions

- **Everything is in the thread.** Tool calls appear as condensed lines; the
  detail is in the **transcript viewer** (`Ctrl+O`), which "shows detailed tool usage and
  execution, with timestamp and model on every assistant message" and
  expands the lines normally condensed — for example several MCP calls reduced to
  `Called slack 3 times`. It is a model of **summary by default, detail on demand** at the
  level of the whole thread, not only of the block.
- **Permission modes** cycled with `Shift+Tab`, with a permanent indicator in the status
  bar: `⏸ manual mode on` (`default`), `⏵⏵ accept edits on`, `⏸ plan mode on`,
  `⏵⏵ auto mode on`, `⏵⏵ don't ask on`, `⏵⏵ bypass permissions on`.
- **Permission prompt**: options "Yes", "Yes, and don't ask again" (saved rule,
  or "for the rest of the session" depending on the tool type), "No". `Esc` declines. `Tab` on
  Yes or No opens a **comment field** attached to the answer — the "don't ask again"
  options do not accept one. The left/right arrows navigate between dialog tabs.
  The product notes that the broad options are offered only "when the prompt can show
  everything they would allow".
- **Plan mode**: the agent reads and explores but does not edit; edits are blocked until
  approval. When the plan is ready, it is presented with three choices: **"Yes, and use auto
  mode"** (or "Yes, auto-accept edits" if auto is unavailable), **"Yes, manually approve
  edits"**, **"No, keep planning"**. `Ctrl+G` opens the plan in the editor to correct it
  before continuing. Approving a plan changes the session's permission mode.
- **Task list**: `Ctrl+T` toggles the view, **five tasks displayed at a time**, state
  pending / in progress / complete, persisted across sessions, collapsed when empty.
- **Interruption**: `Esc` stops the response or the tool call in progress while keeping the work
  done; queued messages are sent afterwards. `Esc Esc` on an empty input opens the rewind
  menu (checkpoints).

### Cursor — reviewing changes

The diff "shows the changes as they happen" directly in the editor, with a
**Stop** button (and `Cmd+Shift+Backspace`) to stop midway. Afterwards, a
**Review** button then **Find Issues** launches a line-by-line re-read of the proposed
edits; the Source Control tab compares against the main branch. The documentation
consulted does not detail an accept/reject-per-hunk mechanism — not verified.

OpenCode (TUI) brings two useful ideas: `/details` globally toggles the display of the
tools' execution detail, `diff_style` is `auto` or `stacked`, and an "attention" system
(desktop notification + sound) warns on **question, permission, session error
and session finished**. Relevant for Hemera, which is a desktop application.

## 3. Mapping `session/update` → UI element

ACP carries the whole course of a turn in `session/update` notifications bearing a
`sessionUpdate` discriminant.

| `sessionUpdate` | Payload | UI element | beui piece |
|---|---|---|---|
| `agent_message_chunk` | `content` (text), `messageId` stable over one logical message | streaming assistant bubble, rendered markdown, actions at the end | `streaming-response` inside `message` |
| `agent_thought_chunk` | reasoning content | collapsed "thinking" block, summary "Thought for Xs" | `agent-activity` (reasoning type) + `ThinkingShimmer` |
| `user_message_chunk` | user content echoed by the agent | user bubble (useful when resuming a session) | `message-bubble` variant `tint`, `align:"end"` |
| `tool_call` | `toolCallId`, `title`, `kind`, `status:"pending"`, `rawInput`, `locations` | collapsed tool row, icon according to `kind` | `tool-result` (status `running`) |
| `tool_call_update` | status `pending` → `in_progress` → `completed`/`failed`, `content[]`, `rawOutput` | update of the same row by `toolCallId` | `tool-result`; `collapseOnComplete` |
| `content` content | text / image / resource blocks | body of the tool block | `tool-result` + `code-block` |
| `diff` content | absolute `path`, `oldText` (null if new file), `newText` | collapsed diff with +/− counter | `file-diff` |
| `terminal` content | `terminalId`, live output, persistent after release | live console following the live edge | **missing** (`tool-result kind:"terminal"` is static) |
| `plan` | `entries[]`: `content`, `priority` high/medium/low, `status` pending/in_progress/completed; **the client MUST replace the whole plan** | pinned plan, status checkboxes, counter | `todo-list` (no priority, to be added) |
| `available_commands_update` | `availableCommands[]`: `name`, `description`, optional `input.hint` | `/` autocompletion in the composer | `prompt-input` (`actions`) — the dynamic list is missing |
| `current_mode_update` | `currentModeId` | persistent mode indicator next to the composer | **missing** |
| `usage_update` | `used`, `size`, `cost { amount, currency }` | context / cost gauge | **missing** |

A tool call's `kind` is `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`,
`fetch`, `other` — ACP says explicitly that this field serves to choose the icon and the
visual treatment (a `delete` is not presented like a `read`). The `locations` (absolute path +
optional line) exist for Zed's "follow-along" feature: in Hemera they
make the title of a tool block clickable.

What is missing on beui's side, in plain terms: **live terminal**, **mode indicator**, **dynamic
command palette**, **usage gauge**, **plan priority**, **diff review with
accept/reject**, and **a blocking block that does not collapse**.

## 4. Permission requests

ACP: `session/request_permission` carries `sessionId`, a `toolCall` (`ToolCallUpdate`, hence the
title, the `kind`, and already the content — including a diff) and `options: PermissionOption[]`.
Each option has a `kind` among `allow_once`, `allow_always`, `reject_once`, `reject_always`.
The answer is a `RequestPermissionOutcome`: `selected` with the `optionId`, or `cancelled`
when a `session/cancel` came through.

Recommended UI for Hemera:

- **In the thread, in place of the tool block concerned**, not in a modal: the request is
  about a call already announced, and a modal cuts the user off from the context that justifies it.
  That is the choice of beui (`tool-approval`), of Zed (allow/deny/confirm in the thread) and of
  Claude Code.
- **Mandatory content**: the tool name, a sentence on what it will do, the decisive
  parameters (`parameters` label/value, command or path as highlighted code), and the complete diff
  when the `toolCall` carries one — one does not approve an edit without seeing it.
- **Buttons in order of increasing risk**: `reject_once` as secondary action,
  `allow_once` as primary action, `allow_always` as an explicit and distinct tertiary, because
  it creates a persistent rule. The options come from the server: the UI **iterates over
  `options`**, it does not hard-code three buttons. `reject_always` exists and must be
  rendered when it is sent.
- **Claude Code rule to adopt**: offer an "always" only if the prompt shows
  the exact extent of what it allows; otherwise, once only. And say where the rule is
  saved (session, or project).
- **Shortcuts**: `Enter` on the focused option, `Esc` = reject once, arrows to
  change option. An optional comment field on rejection (the idea of Claude Code's `Tab`)
  gives the agent something to correct its course with.

**The thread during the block**: the permission card is the last element and **does not
collapse**; the `message-scroller` scrolls to it and keyboard focus goes there. The activity
blocks in progress switch from `working` to a neutral "waiting" state, the progress
indicator stops (it would be lying), and the composer displays "waiting for your answer"
with the stop button still active — `session/cancel` remains possible and will translate into a
`cancelled`. A desktop notification + sound when the window does not have focus, as OpenCode
does for question and permission. After the answer, the card collapses into a line carrying the
decision and the timestamp, then the thread resumes.

## 5. Rendering streamed text

- **Markdown in chunks**: parse at each chunk and render the tree, without ever rewriting the
  DOM already laid down. The hard point is incomplete markdown — a code block or bold closing
  not yet arrived. The workaround: tolerate open nodes (close them virtually at the end
  of the buffer) and memoise only finished blocks, identified by a stable index. beui documents
  no parser: `streaming-response` takes the already rendered content as `children` and
  merely guarantees that "links stay clickable, lists keep their hierarchy,
  code blocks stay readable without layout shift". The choice of parser remains Hemera's.
- **Code blocks filling up**: `code-block` with `status:"streaming"`, Shiki and a
  **token cache** to survive rapid updates, bounded height (`maxHeight` 280)
  and internal scrolling — the block therefore never pushes the rest of the thread.
- **Stable layout**: height reserved by the container, not by the content; no layout
  animation on growing blocks (opacity and transform only); the end actions
  appear only at the `complete` status and at a reserved height, otherwise the thread jumps at every
  end of response.
- **Following the live edge**: `followOutput` stays true as long as the reader is less than
  `followThreshold` (56 px) from the bottom; as soon as they scroll up, release — and show a
  "back to bottom" button with the number of new elements. `onFollowChange` is the hook.
  The sub-case: when an inner block (terminal, code) scrolls on its own, it must not steal
  the thread's scrolling.
- **Accessibility**: `aria-busy="true"` during the stream, a live region to announce the start and
  the end of the response (`announce` at beui), and a **polite** `aria-live` — not assertive, otherwise
  each chunk interrupts the screen reader.
- **`prefers-reduced-motion`**: instant scrolling instead of smooth, shimmer and rolling
  text replaced by a direct change, block entrances without transform, dither and
  decorative animations cut. All beui components wire a `useReducedMotion`;
  Hemera must do it at the level of the motion tokens, once, not component by component.

## Proposed component list for Hemera

One component per line, with the beui piece it draws from.

**`message/`**
- `MessageList` — thread viewport, follows the live edge, releases on scroll, back-to-bottom button → `message-scroller`
- `MessageRow` — user/assistant row, avatar, header, footer → `message`
- `MessageBubble` — bubble surface, variants and alignment → `message-bubble`
- `UserMessage` — editable/resumable user bubble (Zed's editable card) → `message-bubble` + `approval-card`
- `AgentResponse` — streamed response, streaming/complete/error status, copy/retry actions → `streaming-response`
- `Markdown` — incremental markdown rendering tolerant of open nodes → none (to be written)
- `CodeBlock` — Shiki code, line numbers, streamed filling, copy → `code-block`

**`activity/`**
- `ActivityStream` — collapsed chronological stream of a turn's thoughts, searches and tools → `agent-activity`
- `ThoughtBlock` — collapsed `agent_thought_chunk`, summary "Thought for Xs" → `agent-activity` + `ThinkingShimmer`
- `ToolCallCard` — one row per `toolCallId`, icon according to `kind`, status, clickable `locations` → `tool-result`
- `ToolCallGroup` — groups consecutive calls of the same `kind` into "Ran N tools" → `agent-activity`
- `TerminalOutput` — live terminal output per `terminalId`, follows the bottom, persists after release → none (to be written)
- `AgentStatus` — action verb + timer + glyph while working → `agent-loading-states` (`AgentProgress`)
- `Disclosure` — animated collapsible primitive, base of all the blocks above → `AgentDisclosure`

**`approval/`**
- `PermissionRequest` — blocking card of `session/request_permission`, buttons derived from `options` → `tool-approval`
- `PermissionOptionList` — rendering of the `PermissionOption`s by `kind`, keyboard, scope of the rule → `tool-approval`
- `AgentQuestion` — free or multiple-choice question from the agent, custom answer → `approval-card`
- `DecisionSummary` — collapsed line after the decision: chosen option, timestamp → `tool-approval` (final states)

**`plan/`**
- `PlanPanel` — pinned plan, fully replaced at each `plan`, progress counter → `todo-list`
- `PlanEntryRow` — one entry: morphed status, priority high/medium/low → `todo-list` (`TodoStatusIcon`)

**`diff/`**
- `FileDiff` — diff of one file, progressive lines, live +/− counter → `file-diff`
- `DiffReview` — review of all the touched files, accept/reject per hunk and globally → none (inspired by Zed's multi-buffer)
- `ChangeSummary` — pinned accordion bar "N files, M lines" → `file-diff` (`ChangeCount`)
- `CheckpointMarker` — restore point in the thread → none (inspired by Zed and Claude Code)

**`composer/`**
- `PromptComposer` — auto-growing textarea, submit ↔ stop, attachments → `prompt-input`
- `CommandPalette` — `/` commands from `available_commands_update`, with `input.hint` → `prompt-input` (`actions`)
- `ContextMention` — `@` mentions of files, folders, symbols → `ai-sidebar` (resource rows)
- `ModeIndicator` — current mode, changed via `session/set_mode`, updated by `current_mode_update` → none (inspired by the Claude Code status bar)
- `UsageMeter` — context consumed and cost from `usage_update` → none (to be written)
- `BlockedBanner` — the composer's "waiting for your answer" state during a block → none (to be written)

## Open questions

1. **Which streaming markdown parser?** No source consulted recommends one; beui leaves
   the rendering to the caller. To be decided at implementation, with a test on truncated markdown.
2. **Grouping tool calls**: at what threshold to collapse into "Ran N tools"? Zed and
   Claude Code do it (`Called slack 3 times`) but no numbered rule is documented.
3. **The diff: inline or panel?** Zed offers both via `agent.single_file_review`. Hemera
   has no editor: it must be decided whether the accept/reject review is a side panel, a
   tab, or stays in the thread.
4. **Does accept/reject per hunk make sense under ACP?** The protocol defines no
   action for partially rejecting a diff already applied; the only handle is the permission **before** the
   `tool_call`. To be checked against the client capabilities spec (`fs/write_text_file`) and
   against what Zed actually does — not verified.
5. **Checkpoints**: Zed and Claude Code have them, ACP says nothing about them. A client-specific feature,
   to be specified separately or set aside.
6. **`usage_update`**: documented in the spec, not seen in the products observed. To be displayed
   or not depending on the room in the composer.
7. **Desktop notifications** (question, permission, error, end of session): taken
   from OpenCode, they touch Electron's main process, hence another piece of work.
8. **Linux verification**: this machine is Windows; the rendering of the components and the
   scrolling behaviour have not been verified on Linux.
9. **No beui component was executed**: everything described here comes from the
   documentation pages of 16 September 2026, not from a local trial.

## Sources

- beui, agents components index — https://beui.dev/components/agents
- beui, pages consulted under https://beui.dev/components/agents/: `message`,
  `message-bubble`, `message-scroller`, `streaming-response`, `citations`, `loading-states`,
  `todo-list`, `agent-activity`, `tool-result`, `code-block`, `file-diff`, `tool-approval`,
  `approval-card`, `ai-sidebar`, `chat-app`, `prompt-input`, `image-generation`. Note:
  `agent-loading-states` returns a 404; the page is at `/loading-states` and the package
  installs under `@beui/reasoning-text`.
- beui, repository and MIT licence — https://github.com/starc007/ui-components
- Zed, Agent Panel — https://zed.dev/docs/ai/agent-panel
- Zed, External Agents (ACP) — https://zed.dev/docs/ai/external-agents
- ACP, Prompt Turn — https://agentclientprotocol.com/protocol/prompt-turn
- ACP, Tool Calls — https://agentclientprotocol.com/protocol/tool-calls
- ACP, Agent Plan — https://agentclientprotocol.com/protocol/agent-plan
- ACP, Session Modes — https://agentclientprotocol.com/protocol/session-modes
- ACP, Slash Commands — https://agentclientprotocol.com/protocol/slash-commands
- ACP, Schema — https://agentclientprotocol.com/protocol/schema
- Claude Code, Interactive mode — https://code.claude.com/docs/en/interactive-mode
- Claude Code, Configure permissions — https://code.claude.com/docs/en/permissions
- Claude Code, Choose a permission mode — https://code.claude.com/docs/en/permission-modes
- Cursor, Review — https://cursor.com/docs/agent/review
- OpenCode, TUI — https://opencode.ai/docs/tui/
