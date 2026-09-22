/**
 * One control for the agent, its model, its effort and its mode (design D17-11, D17-14).
 *
 * Four questions that only make sense in that order — which agent, then which of the models
 * *that* agent announced, then how hard it should think and what it may do without asking —
 * used to be four selectors side by side in the foot of the composer. They wrapped onto a
 * second line as soon as a model had a long name, and the box grew a band the moment an agent
 * was picked: the frame changed height while it was being read. One trigger, one panel, and the
 * panel is where the depth goes.
 *
 * This is the door the application comes through, and it is deliberately thin. The picker is
 * being chosen between three panels that take these same props — stages, panes and a palette,
 * side by side in the catalogue under `Blocks/Composer/AgentModelMenu` — and until one of them
 * is kept, the application follows **A, the stages**: one list at a time, the agents first and
 * the models of the one that was picked after them. Pointing this name at another variant is
 * the one line to change, and nothing that imports the design system has to know it happened.
 *
 * The props, the types and every piece the three share live in `agent-model-menu-shared.tsx`.
 */

export { AgentModelMenuStages as AgentModelMenu } from './agent-model-menu-stages.tsx'
export type {
  AgentModelMenuProps,
  EffortChoice,
  ModeChoice,
  ModelChoice,
  OfferedAgent,
} from './agent-model-menu-shared.tsx'
