/**
 * What a reader reads a tool by: a label of its own and a mark of its own (recette 3 of
 * 23 September 2026).
 */

import { describe, expect, test } from 'vite-plus/test'

import { TOOL_LABELS, TOOL_NAMES } from '#index.ts'

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
  })
})
