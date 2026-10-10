/**
 * The events of a check and of a launch (#139), about their mission, naming its Project for the
 * window. Apart from the check and its runs, so the gate imports nothing that imports the sessions
 * back.
 */

import type { EventPayload, NewEvent } from '../journal.ts'

/** One of a check's events. */
export const checkEvent = (
  type: string,
  row: { readonly id: string; readonly missionId: string },
  projectId: string,
  payload: EventPayload = {},
) =>
  ({
    type,
    entityKind: 'mission',
    entityId: row.missionId,
    source: 'system',
    author: 'hemera',
    payload: { ...payload, projectId, checkId: row.id },
  }) satisfies NewEvent

/** One of a launch's events. */
export const launchEvent = (
  type: string,
  row: { readonly id: string; readonly missionId: string },
  projectId: string,
  payload: EventPayload = {},
) =>
  ({
    type,
    entityKind: 'mission',
    entityId: row.missionId,
    source: 'system',
    author: 'hemera',
    payload: { ...payload, projectId, launchId: row.id },
  }) satisfies NewEvent
