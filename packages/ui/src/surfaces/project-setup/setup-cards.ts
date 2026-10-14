import type { SetupAgent, SetupCardEntry } from './project-setup.tsx'

/** The cards shown: once the agent stopped, those it had not written are not drawn. */
export const shownCards = (
  agent: SetupAgent,
  cards: readonly SetupCardEntry[],
): readonly SetupCardEntry[] =>
  agent === 'failed' ? cards.filter((card) => card.status.state !== 'reading') : cards
