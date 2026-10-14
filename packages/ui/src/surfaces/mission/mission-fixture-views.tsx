import { Button } from '../../components/button/button.tsx'
import {
  IconBook2,
  IconFileText,
  IconGitCompare,
  IconListCheck,
  IconMessages,
} from '../../icons.ts'
import { type MissionView } from './mission-frame.tsx'
import { REVIEW } from './mission-fixture-review.ts'
import { Prose } from './mission-prose.tsx'

/** The views ACME-12 can open over its Review page, by id; a task's id is `task:T2`. */
export function viewsOf(openSpec: () => void): readonly MissionView[] {
  const tasks = REVIEW.requirements.flatMap((requirement) => requirement.tasks)
  return [
    {
      id: 'spec',
      title: 'Spec',
      icon: <IconFileText size="sm" />,
      width: 'wide',
      actions: (
        <Button variant="ghost" size="sm">
          Copy as Markdown
        </Button>
      ),
      body: <Prose title="Frozen yesterday at 17:02" lines={30} />,
    },
    ...tasks.map((task): MissionView => ({
      id: `task:${task.id}`,
      title: `${task.id} · ${task.title}`,
      icon: <IconListCheck size="sm" />,
      width: 'narrow',
      body: <Prose title={`${task.repositories.join(', ')} · ${task.state}`} lines={12} />,
    })),
    {
      id: 'round:1',
      title: 'Round 1',
      icon: <IconMessages size="sm" />,
      width: 'narrow',
      actions: (
        <Button variant="secondary" size="sm" onClick={openSpec}>
          Open the Spec
        </Button>
      ),
      body: <Prose title="Four points, all addressed" lines={10} />,
    },
    {
      id: 'diff',
      title: 'Diff',
      icon: <IconGitCompare size="sm" />,
      width: 'wide',
      body: <Prose title="14 files in api, 3 in web, 1 in shared" lines={60} wide />,
    },
    {
      id: 'memory',
      title: 'Memory',
      icon: <IconBook2 size="sm" />,
      width: 'wide',
      body: <Prose title="Now, Journal, Notes" lines={20} />,
    },
  ]
}
