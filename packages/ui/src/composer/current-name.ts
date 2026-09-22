/**
 * What the agent is on, named as the agent named it (design D17-11).
 *
 * An agent may report a current value it offers no row for: a Session resumed onto a model its
 * own picker leaves out answers with a model the list does not carry, and the protocol says a
 * client handing that value back is not in error — the Claude adapter refuses a value it cannot
 * select "unless it is the one the option reports" (`setSessionConfigOption`). The trigger
 * therefore says the value itself rather than dropping the model out of what it says, and a
 * Session is never drawn as one with no model at all.
 */
export function nameOfCurrent(
  choices: readonly { readonly id: string; readonly label: string }[],
  current: string | null,
): string | undefined {
  if (current === null) return undefined
  return choices.find((one) => one.id === current)?.label ?? current
}
