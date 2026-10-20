/**
 * The three defaults PR #466 built, each beside the way it could have gone: changes saved one by
 * one or together, the pull requests' part once for the Project or per repository, and a
 * repository's own changes dropped or kept when its preset changes.
 */
import { type ReactNode, useState } from 'react'

import { withPreset } from '../../blocks/project-settings/delivery-edits.ts'
import { presetSteps } from '../../blocks/project-settings/delivery-fixtures.ts'
import type {
  DeliveryRepository,
  DeliveryRules,
  Preset,
  RecipeStep,
} from '../../blocks/project-settings/delivery-model.ts'
import { FRAME_BAND, OpenLine, QUIET_BAND } from '../../blocks/project-settings/delivery-rules.tsx'
import { pushWords } from '../../blocks/project-settings/delivery-words.ts'
import { Button } from '../../components/button/button.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Select } from '../../components/select/select.tsx'
import { SameEnd, SamePullRequests, SameWaves } from './frames.tsx'
import { GesturePage } from './gesture-page.tsx'

const nothing = (): void => {}

/**
 * The alternative to saving at each change: the changes gather, unsaved, and a bar at the foot of
 * the section counts them, with Discard and Save. What the engine refuses still stands at its
 * place; Save waits until nothing is refused.
 */
export function SavedTogether({
  rules,
  unsaved,
}: {
  rules: DeliveryRules
  /** How many changes wait to be saved. */
  unsaved: number
}): ReactNode {
  return (
    <GesturePage
      foot={
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-0 flex items-center gap-2 rounded-md border border-border bg-surface-rim py-2 pr-2 pl-4 text-sm"
        >
          <span className="min-w-0 flex-1 truncate">
            {unsaved} {unsaved === 1 ? 'change' : 'changes'} not saved
          </span>
          <Button size="sm" variant="ghost">
            Discard
          </Button>
          <Button size="sm" variant="primary">
            Save
          </Button>
        </div>
      }
    >
      <SamePullRequests rules={rules} />
      <SameWaves rules={rules} open={['web']} />
      <SameEnd rules={rules} />
    </GesturePage>
  )
}

/**
 * The alternative to the pull requests' part once for the Project: the frame asks which
 * repository it writes, Every repository first; a repository whose part differs is named in the
 * list, and its lines read its own values.
 */
export function PullRequestsPerRepository({
  rules,
  differs,
}: {
  rules: DeliveryRules
  /** The repositories whose part is their own. */
  differs: readonly string[]
}): ReactNode {
  const [of, setOf] = useState('every')
  const pr = rules.pullRequests
  return (
    <GesturePage>
      <Frame>
        <h3 className={FRAME_BAND}>
          Pull requests <span className={QUIET_BAND}>· before Ship</span>
        </h3>
        <div className="flex items-center gap-3 border-b border-border bg-surface-body py-2 pr-4 pl-4">
          <Select<string>
            label="Pull requests of"
            className="w-settings-name"
            value={of}
            onValueChange={setOf}
            items={[
              { value: 'every', label: 'Every repository' },
              ...rules.repositories.map((one) => ({
                value: one.path,
                label: differs.includes(one.path) ? `${one.path}, its own` : one.path,
              })),
            ]}
          />
          {differs.length > 0 && of === 'every' && (
            <span className="text-xs text-muted-foreground">
              {differs.join(', ')} {differs.length === 1 ? 'keeps its own' : 'keep their own'}
            </span>
          )}
        </div>
        <ul aria-label="Pull requests" className="flex flex-col">
          <OpenLine label="Push and open" value={pushWords(pr)} onOpen={nothing} />
          <OpenLine label="Commit message" value={pr.commit} mono onOpen={nothing} />
          <OpenLine label="Pull request title" value={pr.title} mono onOpen={nothing} />
          <OpenLine label="Reviewers" value="@acme/web, Dana Reyes" onOpen={nothing} />
        </ul>
      </Frame>
      <SameWaves rules={rules} />
      <SameEnd rules={rules} />
    </GesturePage>
  )
}

/**
 * A repository's own changes laid over another preset: a step left out or changed is still so
 * where the new preset has it, an added step follows the same step as before (last in its moment
 * when the new preset lacks it), and a change of a step the new preset lacks is dropped.
 */
export function keptOnPreset(repository: DeliveryRepository, preset: Preset): DeliveryRepository {
  const base = presetSteps(preset, `@acme/${repository.path}`)
  const own = new Map(
    repository.steps.filter((one) => one.origin !== 'added').map((one) => [one.step.id, one]),
  )
  let steps: RecipeStep[] = base.map((one) => {
    const mine = own.get(one.step.id)
    if (mine === undefined || mine.origin === 'preset') return one
    return { step: mine.step, origin: mine.origin, moment: one.moment }
  })
  repository.steps.forEach((one, index) => {
    if (one.origin !== 'added') return
    const before = repository.steps[index - 1]?.step.id
    const at = steps.findIndex((s) => s.step.id === before)
    const lastOfMoment = steps.findLastIndex((s) => s.moment === one.moment)
    const where = at !== -1 ? at + 1 : lastOfMoment + 1
    steps = [...steps.slice(0, where), one, ...steps.slice(where)]
  })
  return { ...repository, preset, steps }
}

/**
 * A repository's preset changed from its line's Select. `drop`, as built: its recipe is the new
 * preset's, its own changes gone. `keep`, the alternative: its own changes laid over the new
 * preset (`keptOnPreset`).
 */
export function PresetChange({
  rules: initial,
  repository,
  way,
}: {
  rules: DeliveryRules
  repository: string
  way: 'drop' | 'keep'
}): ReactNode {
  const [rules, setRules] = useState(initial)
  return (
    <GesturePage>
      <SamePullRequests rules={rules} />
      <SameWaves
        rules={rules}
        open={[repository]}
        onPreset={(path, preset) =>
          setRules(
            way === 'drop'
              ? withPreset(rules, path, preset)
              : {
                  ...rules,
                  repositories: rules.repositories.map((one) =>
                    one.path === path ? keptOnPreset(one, preset) : one,
                  ),
                },
          )
        }
      />
      <SameEnd rules={rules} />
    </GesturePage>
  )
}
