/**
 * Style helpers of the design system.
 *
 * A style is a plain object the renderer paints. There is no cascade and no CSS, so a
 * component composes its layers itself: recipe, state, then the caller's override last.
 */

import type { StyleDesc } from '@gpuix/react'

import type { Theme } from '../tokens/semantic.ts'

export type Style = StyleDesc

/** Merges style layers, the later one winning key by key. */
export function mergeStyle(...layers: (Style | false | null | undefined)[]): Style {
  const merged: Style = {}
  for (const layer of layers) {
    if (layer === false || layer === null || layer === undefined) continue
    Object.assign(merged, layer)
  }
  return merged
}

/**
 * Drops the hover and active layers the renderer paints natively.
 *
 * A disabled control that keeps them changes appearance under the pointer even though React
 * never runs, which is exactly what a disabled control must not do.
 */
export function freezeStyle(style: Style): Style {
  const { hover: _hover, active: _active, ...frozen } = style
  return frozen
}

/** The one focus indicator: a ring painted in the primary accent. */
export function focusRing(theme: Theme): Style {
  return { borderColor: theme.colors.primaryRing }
}

type Defined<Props> = { [Key in keyof Props]-?: Exclude<Props[Key], undefined> }

/**
 * Drops the keys whose value is undefined.
 *
 * The renderer's props reject an explicit `undefined`, so an optional prop a component did
 * not receive is omitted rather than passed through.
 */
export function withoutUndefined<Props extends object>(props: Props): Partial<Defined<Props>> {
  const kept: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) kept[key] = value
  }
  return kept as Partial<Defined<Props>>
}

type VariantGroups = Record<string, Record<string, Style>>

export interface VariantRecipe<Groups extends VariantGroups> {
  /** Layer every result starts from. */
  base?: Style
  /** Named groups of mutually exclusive styles. */
  variants: Groups
  /** Choice applied when the caller names none. */
  defaults?: { [Group in keyof Groups]?: keyof Groups[Group] & string }
}

export type VariantChoice<Groups extends VariantGroups> = {
  [Group in keyof Groups]?: keyof Groups[Group] & string
}

/**
 * Turns a recipe into a resolver. A group the caller does not name falls back to its default;
 * naming a variant the group does not declare fails the typecheck.
 */
export function variants<Groups extends VariantGroups>(
  recipe: VariantRecipe<Groups>,
): (choice?: VariantChoice<Groups>) => Style {
  return (choice = {}) => {
    const layers: Style[] = [recipe.base ?? {}]
    for (const group of Object.keys(recipe.variants) as (keyof Groups & string)[]) {
      const selected = choice[group] ?? recipe.defaults?.[group]
      if (selected === undefined) continue
      const style = recipe.variants[group]![selected]
      if (style !== undefined) layers.push(style)
    }
    return mergeStyle(...layers)
  }
}
