/**
 * The composer, as one piece: the box a sentence is written in, what is done to it, and what
 * the Session it belongs to runs on.
 *
 * One door for the family, because the renderer composes the whole of it at once — a page that
 * draws a composer draws its agent menu, its mode and its attachments in the same breath — and
 * a page reaching for six files is a page that has to be edited every time one of them moves.
 * The package's own barrel hands these out unchanged; nothing here is reached past this file.
 */

export { Composer, type ComposerProps } from './composer.tsx'
export { PromptInput, type PromptInputProps, type PromptShape } from './prompt-input.tsx'
export { ComposerActions, type ComposerActionsProps } from './composer-actions.tsx'
export { ComposerAttachments, type ComposerAttachmentsProps } from './composer-attachments.tsx'
export { MentionMenu, type MentionMenuProps } from './mention-menu.tsx'
export { WorkspacePill, type WorkspaceChoice, type WorkspacePillProps } from './workspace-pill.tsx'

/**
 * What the Session runs on, asked and set in one place (design D17-11, D17-14).
 *
 * `AgentModelMenu` is the agent, its model, its effort and its mode behind one trigger — four
 * answers about one agent, and one panel to give them in. `ModeSelector` is the mode on its own,
 * kept for the catalogue and for a page that sets nothing else; the composer no longer draws it
 * beside the menu. `AgentChoice` is the shape an agent advertises anything in.
 */
export {
  AgentModelMenu,
  type AgentModelMenuProps,
  type EffortChoice,
  type ModeChoice,
  type MenuClassifier,
  type ModelChoice,
  type OfferedAgent,
} from './agent-model-menu.tsx'
export { ModeSelector, type ModeSelectorProps } from './mode-selector.tsx'
export { type AgentChoice } from './agent-choice.ts'
export { UsageMeter, type UsageCost, type UsageMeterProps } from './usage-meter.tsx'
export { BlockedBanner, type BlockedBannerProps } from './blocked-banner.tsx'
