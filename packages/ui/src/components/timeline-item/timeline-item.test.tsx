import { describe, expect, test } from 'bun:test'

import { TimelineItem } from './timeline-item.tsx'
import { useTimelineItem } from './use-timeline-item.ts'
import { mountedCatalogue, nodeOf, textsOf } from '../../../test-harness.tsx'

const AT = new Date(2026, 8, 13, 14, 5)

describe('TimelineItem — comportement au clavier', () => {
  test('a journal entry carries no action and stays out of the focus traversal', () => {
    const root = mountedCatalogue(
      <TimelineItem testId="entry" message="Project created" at={AT} now={AT} />,
    )
    try {
      const entry = nodeOf(root, 'entry')
      root.renderer.focusNext()
      expect(root.renderer.getFocusedElementId()).not.toBe(entry.id)
    } finally {
      root.unmount()
    }
  })

  test('the message and the moment are painted in order', () => {
    const root = mountedCatalogue(
      <TimelineItem testId="entry" message="Project created" at={AT} now={AT} />,
    )
    try {
      expect(textsOf(nodeOf(root, 'entry'))).toEqual(['Project created', '14:05'])
    } finally {
      root.unmount()
    }
  })

  test('the mission tag is painted before the message', () => {
    const root = mountedCatalogue(
      <TimelineItem testId="entry" message="Session opened" at={AT} now={AT} mission="free" />,
    )
    try {
      expect(textsOf(nodeOf(root, 'entry'))).toEqual(['free', 'Session opened', '14:05'])
    } finally {
      root.unmount()
    }
  })

  test('the moment is read from the clock the caller passes, never the real one', () => {
    expect(useTimelineItem({ at: AT, now: AT })).toEqual({ timestamp: '14:05', earlierDay: false })
    expect(useTimelineItem({ at: AT, now: new Date(2026, 8, 14, 9, 0) })).toEqual({
      timestamp: '14:05',
      earlierDay: true,
    })
    expect(useTimelineItem({ at: new Date(2026, 8, 13, 9, 7), now: AT }).timestamp).toBe('09:07')
  })
})
