/**
 * What a reader reads a tool by: a label of its own and a mark of its own (recette 3 of
 * 23 September 2026).
 */

import { describe, expect, test } from 'vite-plus/test'

import { TOOL_LABELS, TOOL_NAMES, offeredTools } from '#index.ts'

/** The build's own tools (D10-13). */
const BUILD_TOOLS = ['build_read', 'task_finished', 'task_blocked']

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
    expect(TOOL_LABELS.commands_propose.label).toBe('Propose command')
    expect(TOOL_LABELS.session_get.label).toBe('Session')
    expect(TOOL_LABELS.build_read).toEqual({ label: 'Read build', mark: 'read-build' })
    expect(TOOL_LABELS.task_finished).toEqual({ label: 'Task finished', mark: 'finish-task' })
    expect(TOOL_LABELS.task_blocked).toEqual({ label: 'Task blocked', mark: 'block-task' })
  })
})

describe('A mission is offered its own tools', () => {
  test('a free Session is offered the code tools and spec_propose alone', () => {
    expect(offeredTools('free')).toEqual(
      TOOL_NAMES.filter((tool) => !['spec_read', 'spec_write', ...BUILD_TOOLS].includes(tool)),
    )
  })

  test('a build Session is offered the code tools and the build tools, and no Spec tool', () => {
    expect(offeredTools('build')).toEqual(
      TOOL_NAMES.filter((tool) => !['spec_read', 'spec_write', 'spec_propose'].includes(tool)),
    )
  })

  test('no other mission is offered a build tool', () => {
    for (const mission of ['free', 'define'] as const) {
      for (const tool of BUILD_TOOLS) expect(offeredTools(mission)).not.toContain(tool)
    }
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
