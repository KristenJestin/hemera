import type { SectionState, SpecChange, SpecSection } from './planning-types.ts'

/** The Spec's sections as its rail lists them: the seven prose ones, Requirements fourth. */
export interface RailEntry {
  name: string
  title: string
  state: SectionState
}

/** The eight sections of the rail, Requirements fourth, in the Spec's order. */
export function railOf(
  sections: readonly SpecSection[],
  requirementsState: SectionState,
): RailEntry[] {
  const prose = sections.map(({ name, title, state }) => ({ name, title, state }))
  return [
    ...prose.slice(0, 3),
    { name: 'requirements', title: 'Requirements', state: requirementsState },
    ...prose.slice(3),
  ]
}

/** The items changed since the last read: a section's name, `R2`, `T3` — a scenario counts for its requirement. */
export function changedSet(changes: readonly SpecChange[]): ReadonlySet<string> {
  return new Set(changes.map((change) => change.item.split('.')[0] ?? change.item))
}

/** The id an element of a section of the Spec carries, for the rail to scroll to it. */
export const sectionAnchor = (name: string): string => `spec-${name}`
