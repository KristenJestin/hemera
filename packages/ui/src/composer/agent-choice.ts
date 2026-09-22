/**
 * One thing an agent lets the user set, as the agent advertises it (design D17-11).
 *
 * The model, the reasoning effort and the permission mode are all the same shape: an id that
 * goes back over the wire, and a name that is read. An agent that advertises none of them is an
 * agent that has nothing to choose, and every control here reads this type so that "the agent did
 * not send it" has one meaning everywhere: no control at all.
 */
export interface AgentChoice {
  /** What goes back to the agent when this choice is taken. */
  id: string
  /** What the reader sees, in the agent's own words. */
  name: string
}
