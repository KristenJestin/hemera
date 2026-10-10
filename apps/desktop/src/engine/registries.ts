/**
 * What the engine registers where it is composed: the folders of the data folder a backup carries,
 * relative to it (each ticket that creates one adds it here), and the steps that reconcile a
 * restored Profile with the world, in their order.
 */

import { SNAPSHOTS_FOLDER } from './building/snapshots.ts'
import { MISSIONS_FOLDER } from './memory/files.ts'
import { RESTORED_REQUESTS } from './permissions/requests.ts'
import { RESTORED_PROBES } from './planning/probes.ts'

export const BACKUP_FOLDERS: ReadonlyArray<string> = [MISSIONS_FOLDER, SNAPSHOTS_FOLDER]
export const RECONCILIATION_STEPS = [RESTORED_REQUESTS, RESTORED_PROBES] as const
