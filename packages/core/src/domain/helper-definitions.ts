/**
 * The defined helpers (#145): one schema every definition is written against, and one file per
 * defined helper, named after its id and decoded by that schema as the application loads. What a
 * helper is, receives, may do and hands back is written in one place and checked by one rule. In
 * 1.0 there is one: the Prototyper.
 */

import { Schema } from 'effect'

import {
  AvatarTone,
  FreeHelperResult,
  HELPER_TOOLS,
  HelperInput,
  HelperPlace,
  PrototyperResult,
  WRITING_TOOLS,
} from './helpers.ts'
import { prototyper } from './helpers/prototyper.ts'
import { TOOL_NAMES } from './tools.ts'

/** The shapes a helper's result is read against in 1.0. */
const RESULT_SHAPES = [FreeHelperResult, PrototyperResult] as const
type ResultShape = (typeof RESULT_SHAPES)[number]

const isResultShape = (value: unknown): value is ResultShape =>
  RESULT_SHAPES.some((shape) => shape === value)

const Text = Schema.String.check(Schema.isNonEmpty())

const named = (list: ReadonlyArray<string>, tool: string) => list.some((name) => name === tool)

/** A definition's tools: each a tool of the role table, listed once, never a helper tool. */
const Tools = Schema.Array(Text).check(
  Schema.isNonEmpty(),
  Schema.makeFilter((tools) => tools.every((tool) => named(TOOL_NAMES, tool)), {
    expected: 'tools of Hemera’s role table',
  }),
  Schema.makeFilter((tools) => new Set(tools).size === tools.length, {
    expected: 'a list where no tool is listed twice',
  }),
  Schema.makeFilter((tools) => !tools.some((tool) => named(HELPER_TOOLS, tool)), {
    expected: 'without helper_launch and helper_read: the depth a helper stands at gives them',
  }),
)

export const HelperDefinition = Schema.Struct({
  /** Stable: what the launching agent names it by in `helper_launch`. */
  id: Text.check(
    Schema.isPattern(/^[a-z]+(-[a-z]+)*$/, { expected: 'lowercase words joined by hyphens' }),
  ),
  name: Text,
  /** The icon of its chip. */
  icon: Text,
  /** A tone of the avatar palette (#8). */
  colour: AvatarTone,
  /** One sentence, given to the launching agent. */
  description: Text,
  /** Its instruction text: the role layer of its session's instructions. */
  role: Text,
  inputs: Schema.Array(HelperInput),
  /** Hemera tools of the role table; never the helper tools, which the depth gives. */
  tools: Tools,
  place: HelperPlace,
  writes: Schema.Boolean,
  /** The shape of its result, read from `helper_result`'s arguments. */
  result: Schema.declare(isResultShape),
}).check(
  Schema.makeFilter(
    (definition) =>
      definition.writes || !definition.tools.some((tool) => named(WRITING_TOOLS, tool)),
    { expected: 'a helper that does not write without fs_write or fs_edit' },
  ),
)
export type HelperDefinition = typeof HelperDefinition.Type

/** The Prototyper, decoded by the one schema as the application loads. */
export const PROTOTYPER: HelperDefinition = Schema.decodeUnknownSync(HelperDefinition)(prototyper)

/** Every defined helper Hemera ships. */
export const DEFINED_HELPERS: ReadonlyArray<HelperDefinition> = [PROTOTYPER]

/** The defined helper of this id, or null for one Hemera does not ship. */
export const definedHelperNamed = (id: string): HelperDefinition | null =>
  DEFINED_HELPERS.find((definition) => definition.id === id) ?? null
