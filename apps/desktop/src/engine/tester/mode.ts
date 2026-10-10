/**
 * The tester mode's paragraph for the base layer (#45): #40's `TesterMode` port, filled with the
 * ticket's paragraph while the preference is on. A session's instructions are set once at its
 * start, so a change applies to the sessions that start afterwards.
 */

import { TESTER_PARAGRAPH } from '@hemera/core/domain'
import { Effect, Layer } from 'effect'

import { readPreferences } from '../preferences.ts'
import { TesterMode } from '../sessions/ports.ts'
import type { Database } from '../storage/database.ts'

/** Whether instructions were written with the tester mode on: its paragraph is in them. */
export const startedWithTesterMode = (instructions: string): boolean =>
  instructions.includes(TESTER_PARAGRAPH)

export const testerModeLayer = Layer.effect(
  TesterMode,
  Effect.map(
    Effect.context<Database>(),
    (context) => () =>
      readPreferences.pipe(
        Effect.map((preferences) => (preferences.testerMode ? TESTER_PARAGRAPH : null)),
        Effect.orElseSucceed(() => null),
        Effect.provide(context),
      ),
  ),
)
