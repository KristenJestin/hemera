/**
 * What a reader reads a tool by: a label of its own and a mark of its own (recette 3 of
 * 23 September 2026).
 */

import { describe, expect, test } from 'vite-plus/test'

import { TOOL_LABELS, TOOL_NAMES, offeredTools } from '#index.ts'

describe('Every tool has a label and a mark', () => {
  test('one of each per tool, and no two tools share either', () => {
    const labels = TOOL_NAMES.map((tool) => TOOL_LABELS[tool].label)
    const marks = TOOL_NAMES.map((tool) => TOOL_LABELS[tool].mark)

    for (const label of labels) expect(label.trim()).not.toBe('')
    expect(new Set(labels).size).toBe(TOOL_NAMES.length)
    expect(new Set(marks).size).toBe(TOOL_NAMES.length)
    expect(Object.keys(TOOL_LABELS).toSorted()).toEqual([...TOOL_NAMES].toSorted())
  })

  test('in the words the thread reads them in', () => {
    expect(TOOL_LABELS.fs_read.label).toBe('Read file')
    expect(TOOL_LABELS.fs_list.label).toBe('List folder')
    expect(TOOL_LABELS.commands_output.label).toBe('Command output')
    expect(TOOL_LABELS.session_get.label).toBe('Session')
  })
})

describe('A mission is offered its own tools', () => {
  test('a free Session is offered the code tools and spec_propose alone, a build one none', () => {
    expect(offeredTools('free')).toEqual(
      TOOL_NAMES.filter((tool) => !['spec_read', 'spec_write'].includes(tool)),
    )
    expect(offeredTools('build')).toEqual([])
  })
})

describe('A define Session is offered the Spec tools and no write tool', () => {
  test('the Spec tools beside a read-only code set', () => {
    expect([...offeredTools('define')].toSorted()).toEqual(
      [
        'commands_list',
        'commands_output',
        'fs_list',
        'fs_read',
        'project_get',
        'search',
        'session_get',
        'spec_propose',
        'spec_read',
        'spec_write',
      ].toSorted(),
    )
    for (const writes of ['fs_write', 'fs_edit', 'commands_run', 'commands_stop'] as const) {
      expect(offeredTools('define')).not.toContain(writes)
    }
  })
})
