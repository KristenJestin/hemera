/**
 * Gesture 3, where a refusal of a template or of a cleanup step is said. Three places: under the
 * line it refuses, as an approval's is (recommended); under the band of the frame that holds it;
 * or under the section's head, as the app says it today.
 */
import { cn } from 'cn'
import type { ReactNode } from 'react'

import type { DeliveryRules } from '../../blocks/project-settings/delivery-model.ts'
import {
  CELLS,
  CleanupRow,
  FRAME_BAND,
  GLYPH,
  ITEM,
  OpenLine,
  QUIET_BAND,
  Refused,
} from '../../blocks/project-settings/delivery-rules.tsx'
import { pushWords, reviewersWords } from '../../blocks/project-settings/delivery-words.ts'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { IconGitMerge, IconLock } from '../../icons.ts'
import { SameWaves } from './frames.tsx'
import { GesturePage } from './gesture-page.tsx'

const nothing = (): void => {}

/** Where the refusals are said. */
export type RefusalPlace = 'line' | 'band' | 'head'

export interface PlacedRefusals {
  /** The template refused, and why. */
  template: { kind: 'commit' | 'title' | 'body'; words: string }
  /** The cleanup step refused, by id, and why. */
  cleanup: { id: string; words: string }
}

/** A line of the frame, with what refuses it under it when the refusals stand at their lines. */
function WithRefusal({ words, children }: { words: string | undefined; children: ReactNode }) {
  if (words === undefined) return children
  return (
    <li className={cn(ITEM, 'flex flex-col')}>
      <ul className="flex flex-col">{children}</ul>
      <Refused words={words} inset />
    </li>
  )
}

function PullRequestsFrame({
  rules,
  refusals,
  place,
}: {
  rules: DeliveryRules
  refusals: PlacedRefusals
  place: RefusalPlace
}): ReactNode {
  const pr = rules.pullRequests
  const at = (kind: PlacedRefusals['template']['kind']) =>
    place === 'line' && refusals.template.kind === kind ? refusals.template.words : undefined
  return (
    <Frame>
      <h3 className={FRAME_BAND}>
        Pull requests <span className={QUIET_BAND}>· before Ship</span>
      </h3>
      {place === 'band' && (
        <div className="border-b border-border bg-surface-body pt-2">
          <Refused words={refusals.template.words} />
        </div>
      )}
      <ul aria-label="Pull requests" className="flex flex-col">
        <OpenLine label="Push and open" value={pushWords(pr)} onOpen={nothing} />
        <WithRefusal words={at('commit')}>
          <OpenLine label="Commit message" value={pr.commit} mono onOpen={nothing} />
        </WithRefusal>
        <WithRefusal words={at('title')}>
          <OpenLine label="Pull request title" value={pr.title} mono onOpen={nothing} />
        </WithRefusal>
        <WithRefusal words={at('body')}>
          <OpenLine
            label="Pull request body"
            value={pr.body.split('\n')[0] ?? ''}
            mono
            onOpen={nothing}
          />
        </WithRefusal>
        <OpenLine label="Reviewers" value={reviewersWords(pr)} onOpen={nothing} />
        <li className={ITEM}>
          <div className={CELLS}>
            <Checkbox
              checked={pr.requireApproval}
              onCheckedChange={nothing}
              label="Require team approval before Ship"
            />
          </div>
        </li>
        <li className={ITEM}>
          <div className={CELLS}>
            <Checkbox
              checked={pr.reviewDrafts}
              onCheckedChange={nothing}
              label="Review the drafts first"
              description="You read each title and body before its pull request opens."
            />
          </div>
        </li>
      </ul>
    </Frame>
  )
}

function EndFrame({
  rules,
  refusals,
  place,
}: {
  rules: DeliveryRules
  refusals: PlacedRefusals
  place: RefusalPlace
}): ReactNode {
  return (
    <Frame>
      <h3 className={FRAME_BAND}>
        End <span className={QUIET_BAND}>· once everything is delivered</span>
      </h3>
      {place === 'band' && (
        <div className="border-b border-border bg-surface-body pt-2">
          <Refused words={refusals.cleanup.words} />
        </div>
      )}
      <h4 className="flex h-control-sm items-center border-b border-border px-4 text-xs text-muted-foreground">
        Closing
      </h4>
      <ul aria-label="Closing" className="flex flex-col border-b border-border">
        <li className={ITEM}>
          <div className={CELLS}>
            <span className={GLYPH} aria-hidden="true">
              <IconGitMerge size="sm" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              Merge the Spec and its rounds into the living spec
            </span>
            <span className="flex text-muted-foreground">
              <Legend label="Always runs: Done comes after it">
                <IconLock size="sm" />
              </Legend>
            </span>
          </div>
        </li>
      </ul>
      <h4 className="flex h-control-sm items-center border-b border-border px-4 text-xs text-muted-foreground">
        Cleanup
      </h4>
      <ul aria-label="Cleanup" className="flex flex-col">
        {rules.cleanup.map((step) => (
          <WithRefusal
            key={step.id}
            words={
              place === 'line' && refusals.cleanup.id === step.id
                ? refusals.cleanup.words
                : undefined
            }
          >
            <CleanupRow step={step} onOpen={nothing} onRemove={nothing} />
          </WithRefusal>
        ))}
      </ul>
    </Frame>
  )
}

/** The section with a template and a cleanup step refused, each said where `place` says. */
export function RefusalsPlaced({
  rules,
  refusals,
  place,
}: {
  rules: DeliveryRules
  refusals: PlacedRefusals
  place: RefusalPlace
}): ReactNode {
  return (
    <GesturePage
      problem
      refused={
        place === 'head' ? `${refusals.template.words} ${refusals.cleanup.words}` : undefined
      }
    >
      <PullRequestsFrame rules={rules} refusals={refusals} place={place} />
      <SameWaves rules={rules} />
      <EndFrame rules={rules} refusals={refusals} place={place} />
    </GesturePage>
  )
}
