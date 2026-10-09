/**
 * What a mission's header and page are made of, apart from drawing them: whether the Spec shows as
 * frozen, whether Freeze and Cancel are offered, the repository names its marks use, what the
 * outdated mark says moved, and the rows of the mission's own needs. Plain values and functions,
 * no React: `mission-route.tsx` holds the hooks and draws.
 */

import { outdatedReasonSaid } from '@hemera/core/domain'
import type { FreezeReadiness, Mission, Project } from '@hemera/ipc'
import type { MissionStage, NeedRow } from '@hemera/ui'
import { Predicate } from 'effect'

import type { MissionLine } from './missions.ts'
import { cardOf, handlersFor, type NeedHandlers, type NeedTools } from './needs.ts'

/** The stages from which the Spec is frozen, whatever the mission's own flag says. */
const FROZEN_FROM: ReadonlySet<MissionStage> = new Set<MissionStage>([
  'Ready',
  'Building',
  'Review',
  'Shipping',
  'Done',
])

/** Whether the header shows the Spec as frozen: the lock stands from Ready on. */
export function frozenOf(line: Pick<MissionLine, 'stage' | 'frozen'>): boolean {
  return line.frozen || FROZEN_FROM.has(line.stage)
}

/** Cancel is offered at every stage before Done. */
export function cancelOffered(stage: MissionStage): boolean {
  return stage !== 'Done' && stage !== 'Cancelled'
}

/** Freeze is offered in Planning, once the engine says everything is settled. */
export function freezeOffered(stage: MissionStage, readiness: FreezeReadiness | null): boolean {
  return stage === 'Planning' && readiness !== null && readiness.ready
}

/** What the header shows beyond the line itself. */
export interface MissionHeaderModel {
  frozen: boolean
  freeze: boolean
  cancel: boolean
}

export function headerOf(
  line: Pick<MissionLine, 'stage' | 'frozen'>,
  readiness: FreezeReadiness | null,
): MissionHeaderModel {
  return {
    frozen: frozenOf(line),
    freeze: freezeOffered(line.stage, readiness),
    cancel: cancelOffered(line.stage),
  }
}

/** The page registered for a stage, if any. */
export function pageOf<Page>(
  pages: Partial<Record<MissionStage, Page>>,
  stage: MissionStage,
): Page | undefined {
  return pages[stage]
}

/** What a repository is called on a mark: its folder, the main checkout's for `.`. */
function folderName(project: Project, path: string): string {
  const folder = path === '.' ? project.mainCheckout : path
  return folder.split(/[\\/]/).findLast((part) => part !== '') ?? folder
}

/** A repository by the name a mark says it with; an unknown one keeps its id. */
export function repositoryNamer(project: Project | null): (repositoryId: string) => string {
  return (repositoryId) => {
    const found = project?.repositories.find((repository) => repository.id === repositoryId)
    return found === undefined || project === null ? repositoryId : folderName(project, found.path)
  }
}

/** What moved since the Freeze, as the outdated mark keeps it, in words. */
export interface Difference {
  why: string
  difference: string
}

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** The outdated mark's reason and difference, or null when the mission is not outdated. */
export function differenceOf(mission: Mission): Difference | null {
  for (const { mark } of mission.marks) {
    if (Predicate.isTagged(mark, 'Outdated')) {
      return { why: capitalised(outdatedReasonSaid(mark.reason)), difference: mark.difference }
    }
  }
  return null
}

/** The rows of the mission's own needs, oldest first as the engine gives them. */
export function needRowsOfMission(mission: Mission, projectName: string, now: Date): NeedRow[] {
  return mission.needs.map((need) => ({
    id: need.id,
    project: projectName,
    need: cardOf(need, now, mission.key),
  }))
}

/** What each card of the mission does, by need. */
export function needHandlersOf(mission: Mission, tools: NeedTools): (id: string) => NeedHandlers {
  return (id) => {
    const need = mission.needs.find((one) => one.id === id)
    return need === undefined ? {} : handlersFor(need, tools)
  }
}
