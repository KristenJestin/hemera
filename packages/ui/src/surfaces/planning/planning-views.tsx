import type { ReactNode } from 'react'

import { DiscussionThread } from '../../blocks/planning/discussion-thread.tsx'
import type {
  Discussion,
  DiscussionItem,
  Probe,
  ProbeDetail,
} from '../../blocks/planning/planning-types.ts'
import { ProbeReport } from '../../blocks/planning/probes.tsx'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { IconMessages, IconTestPipe } from '../../icons.ts'
import type { MissionView } from '../mission/mission-frame.tsx'
import { discussionViewId, probeViewId } from './planning-page.tsx'

export interface PlanningViewsOf {
  discussions: readonly Discussion[]
  /** The items whose discussion the user is starting: their view holds the first message's field. */
  starting: readonly DiscussionItem[]
  probes: readonly Probe[]
  /** The report of each Probe opened; null or missing while it is read. */
  reports: ReadonlyMap<string, ProbeDetail | null>
  mentionables: readonly Mentionable[]
  onSay: (item: DiscussionItem, text: string) => Promise<void>
  onAccept: (item: DiscussionItem) => Promise<void>
  onClose: (item: DiscussionItem, decision: string | null) => Promise<void>
}

const sameItem = (one: DiscussionItem, other: DiscussionItem): boolean =>
  one.kind === other.kind && one.id === other.id

function Padded({ children }: { children: ReactNode }): ReactNode {
  return <div className="px-5 py-4">{children}</div>
}

/**
 * The views the Planning page opens over itself, at a reading measure: a discussion per item
 * discussed or being started, and a Probe's report per Probe. Their ids are `discussionViewId` and
 * `probeViewId`, which the page's buttons open.
 */
export function planningViews({
  discussions,
  starting,
  probes,
  reports,
  mentionables,
  onSay,
  onAccept,
  onClose,
}: PlanningViewsOf): MissionView[] {
  const threads = [
    ...discussions.map((discussion) => ({ item: discussion.item, discussion })),
    ...starting
      .filter((item) => !discussions.some((discussion) => sameItem(discussion.item, item)))
      .map((item) => ({ item, discussion: null })),
  ]
  return [
    ...threads.map(({ item, discussion }): MissionView => ({
      id: discussionViewId(item),
      title:
        discussion === null ? `Discuss ${item.id}` : `Discussion ${discussion.label} · ${item.id}`,
      icon: <IconMessages size="md" />,
      width: 'narrow',
      body: (
        <Padded>
          <DiscussionThread
            discussion={discussion}
            on={item.id}
            mentionables={mentionables}
            onSay={(text) => onSay(item, text)}
            onAccept={() => onAccept(item)}
            onClose={(decision) => onClose(item, decision)}
          />
        </Padded>
      ),
    })),
    ...probes.map((probe): MissionView => ({
      id: probeViewId(probe.id),
      title: `Probe ${probe.label}`,
      icon: <IconTestPipe size="md" />,
      width: 'narrow',
      body: <ProbeReport probe={reports.get(probe.id) ?? null} />,
    })),
  ]
}
