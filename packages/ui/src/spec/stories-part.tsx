import type { ReactNode } from 'react'

import { InPlaceText } from './in-place-text.tsx'
import type { Mark, StoryView } from './model.ts'
import { PartHead } from './part-head.tsx'

/**
 * The stories of the Spec document: each one sentence of who, what and why, with its ordered
 * criteria under it, edited in place the way a section is (lot 19, brief revision 2).
 *
 * The order of the criteria is the order they are read in and the one the gate checks against:
 * they are numbered by the list itself and never by a field anybody maintains.
 */

const ITEM = 'flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-1'

const ITEM_HEAD = 'flex items-baseline gap-2 text-sm font-semibold'

const KEY = 'font-mono text-xs font-medium text-muted-foreground'

const CRITERIA =
  'ml-5 flex list-decimal flex-col gap-0.5 text-sm marker:font-mono marker:text-xs marker:text-muted-foreground'

const PROSE = 'text-sm leading-relaxed'

export interface StoriesPartProps {
  stories: StoryView[]
  mark: Mark
  /** Whether the stories can be changed: a draft, at its current revision. */
  editable: boolean
  /** What the facts add, when the panel has something to say about edits. */
  note?: string | undefined
  /** A story, once, with what changed in it. */
  onSaveStory: (story: StoryView) => void
}

export function StoriesPart({
  stories,
  mark,
  editable,
  note,
  onSaveStory,
}: StoriesPartProps): ReactNode {
  const criteria = stories.reduce((sum, story) => sum + story.criteria.length, 0)
  const facts: ReactNode[] = [`${criteria} criteria`]
  if (note !== undefined) facts.push(note)
  return (
    <div className="flex flex-col gap-1.5">
      <PartHead title={`Stories · ${stories.length}`} mark={mark} facts={facts} />
      {stories.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No story: this Spec is verified as a whole, by its verification.
        </p>
      ) : (
        <ul aria-label="Stories">
          {stories.map((story) => (
            <li key={story.key} className={ITEM}>
              <p className={ITEM_HEAD}>
                <span className={KEY}>{story.key}</span>
                {story.title}
              </p>
              {editable ? (
                <InPlaceText
                  label={`Narrative of ${story.key}`}
                  value={story.narrative}
                  onCommit={(narrative) => onSaveStory({ ...story, narrative })}
                />
              ) : (
                <p className={PROSE}>{story.narrative}</p>
              )}
              <ol aria-label={`Criteria of ${story.key}`} className={CRITERIA}>
                {story.criteria.map((criterion, index) => (
                  // A criterion is its place in the list: two may say the same words.
                  <li key={index}>
                    {editable ? (
                      <InPlaceText
                        label={`Criterion ${index + 1} of ${story.key}`}
                        value={criterion}
                        onCommit={(text) =>
                          onSaveStory({
                            ...story,
                            criteria: story.criteria.map((one, at) => (at === index ? text : one)),
                          })
                        }
                      />
                    ) : (
                      <span className={PROSE}>{criterion}</span>
                    )}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
