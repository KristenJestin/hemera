/** Style, interaction, motion and keyboard helpers of the design system. */

export {
  useFocusReturn,
  useFocusState,
  useFocusTraversal,
  useFocusable,
  useFocusedElement,
} from './interaction.ts'
export type { Focusable, FocusReturn, FocusState, FocusTraversal } from './interaction.ts'
export {
  ACTIVATION_KEYS,
  DISMISS_KEY,
  SHORTCUTS,
  TRAVERSAL_KEY,
  conflictingShortcuts,
  isActivationKey,
  isDismissKey,
  traversalIntentOf,
} from './keyboard.ts'
export type { Shortcut, TraversalIntent } from './keyboard.ts'
export { CONSTRAINED_TARGETS, FREE_TARGETS, canAnimate, transition } from './motion.ts'
export type { MotionContext, MotionSpeed, MotionTarget, Transition } from './motion.ts'
export { focusRing, freezeStyle, mergeStyle, variants } from './style.ts'
export type { Style, VariantChoice, VariantRecipe } from './style.ts'
