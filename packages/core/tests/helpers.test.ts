/**
 * The helpers of Building (#145): the one schema of a defined helper and what it refuses, the
 * Prototyper as the only defined helper, the shapes a result is read against, the tools a helper's
 * session holds by its depth, its task and whether it writes, and the brief it is handed.
 */

import { Result, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  DEFINED_HELPERS,
  FreeHelperResult,
  HELPER_DEPTH,
  HelperDefinition,
  PROTOTYPER,
  PrototyperResult,
  TOOL_NAMES,
  TOOLS,
  avatarToneOf,
  definedHelperNamed,
  helperBriefFields,
  helperLabel,
  helperNumberOf,
  helperToolsOf,
  toolsOf,
} from '../src/domain/index.ts'
import { formatSchemaError } from '../src/schema/index.ts'

const decode = Schema.decodeUnknownResult(HelperDefinition)

const SKETCHER = {
  id: 'sketcher',
  name: 'Sketcher',
  icon: 'flask',
  colour: 'info',
  description: 'Sketches one thing.',
  role: '# Role: Sketcher',
  inputs: ['brief'],
  tools: ['fs_read', 'fs_write', 'helper_result'],
  place: 'prototype',
  writes: true,
  result: PrototyperResult,
}

/** What a definition is refused with, in words; null when it reads. */
const refusedWith = (more: Partial<typeof SKETCHER> = {}): string | null => {
  const decoded = decode({ ...SKETCHER, ...more })
  return Result.isSuccess(decoded) ? null : formatSchemaError(decoded.failure)
}

/** What a result is refused with, in words; null when it reads. */
const resultRefused = (
  shape: typeof FreeHelperResult | typeof PrototyperResult,
  raw: Readonly<Record<string, string | ReadonlyArray<string>>>,
) => {
  const decoded = Schema.decodeUnknownResult(shape)(raw)
  return Result.isSuccess(decoded) ? null : formatSchemaError(decoded.failure)
}

describe('The schema of a defined helper', () => {
  test('a definition with every field reads', () => {
    expect(refusedWith()).toBeNull()
  })

  test('the id is lowercase words joined by hyphens', () => {
    expect(refusedWith({ id: 'Sketch_er' })).toContain('lowercase words')
  })

  test('a read-only helper with a write tool is refused', () => {
    expect(refusedWith({ writes: false })).toContain(
      'a helper that does not write without fs_write',
    )
  })

  test('a tool listed twice is refused', () => {
    expect(refusedWith({ tools: ['fs_read', 'fs_read', 'helper_result'] })).toContain(
      'no tool is listed twice',
    )
  })

  test('a helper tool is refused: the depth decides it', () => {
    expect(refusedWith({ tools: ['fs_read', 'helper_launch', 'helper_result'] })).toContain(
      'the depth a helper stands at gives them',
    )
  })

  test('an unknown tool is refused', () => {
    expect(refusedWith({ tools: ['fs_read', 'teleport', 'helper_result'] })).toContain(
      'tools of Hemera’s role table',
    )
  })

  test('a colour outside the avatar palette is refused', () => {
    expect(refusedWith({ colour: 'pink' })).not.toBeNull()
  })
})

describe('The Prototyper is the only defined helper', () => {
  test('one definition, the Prototyper, decoded by the schema at load', () => {
    expect(DEFINED_HELPERS.map((one) => one.id)).toEqual(['prototyper'])
    expect(definedHelperNamed('prototyper')).toBe(PROTOTYPER)
    expect(definedHelperNamed('reviewer')).toBeNull()
  })

  test('it works in a throwaway folder, writes there, and holds the tools of the ticket', () => {
    expect(PROTOTYPER.place).toBe('prototype')
    expect(PROTOTYPER.writes).toBe(true)
    expect(PROTOTYPER.tools).toEqual([
      'fs_read',
      'fs_list',
      'search',
      'fs_write',
      'fs_edit',
      'commands_run',
      'commands_output',
      'commands_stop',
      'note_add',
      'spec_read',
      'helper_result',
    ])
    // Every tool it lists is its role's in the role table.
    expect(
      PROTOTYPER.tools.filter((tool) => !toolsOf('prototyper').some((one) => one === tool)),
    ).toEqual([])
  })
})

describe('A result missing a field is refused naming it', () => {
  test('a free helper’s result without `left`', () => {
    expect(
      resultRefused(FreeHelperResult, { summary: 'Done.', changed: [], checked: [] }),
    ).toContain('`left`')
  })

  test('the Prototyper’s result without `does_not_work`', () => {
    expect(PROTOTYPER.result).toBe(PrototyperResult)
    expect(
      resultRefused(PrototyperResult, { tried: 'A CSV writer.', works: ['It writes.'], files: [] }),
    ).toContain('`does_not_work`')
  })
})

describe('The tools of a helper’s session', () => {
  const role = toolsOf('helper')
  const free = { role, defined: null, chosen: null } as const

  test('a helper at depth 1 may launch and read its own; at depth 2 it may not', () => {
    const first = helperToolsOf({ ...free, depth: 1, task: false, writes: true })
    const second = helperToolsOf({ ...free, depth: HELPER_DEPTH, task: false, writes: true })
    expect(first).toEqual(expect.arrayContaining(['helper_launch', 'helper_read', 'helper_result']))
    expect(second).not.toContain('helper_launch')
    expect(second).not.toContain('helper_read')
    expect(second).toContain('helper_result')
  })

  test('the task tools only when it is tied to a task', () => {
    const tied = helperToolsOf({ ...free, depth: 1, task: true, writes: true })
    const untied = helperToolsOf({ ...free, depth: 1, task: false, writes: true })
    expect(tied).toEqual(expect.arrayContaining(['task_start', 'task_finished', 'task_blocked']))
    expect(untied.filter((tool) => tool.startsWith('task_'))).toEqual([])
  })

  test('no write tool when it does not write, and a free helper never has report_need', () => {
    const reading = helperToolsOf({ ...free, depth: 1, task: false, writes: false })
    expect(reading).not.toContain('fs_write')
    expect(reading).not.toContain('fs_edit')
    expect(role).not.toContain('report_need')
  })

  test('a free helper holds what its parent chose, and helper_result always', () => {
    const chosen = helperToolsOf({
      ...free,
      depth: 1,
      task: false,
      writes: false,
      chosen: ['fs_read', 'search'],
    })
    expect(chosen.filter((tool) => !tool.startsWith('hemera_'))).toEqual([
      'fs_read',
      'search',
      'helper_launch',
      'helper_read',
      'helper_result',
    ])
  })

  test('the Prototyper holds its definition’s tools', () => {
    const tools = helperToolsOf({
      role: toolsOf('prototyper'),
      defined: PROTOTYPER.tools,
      chosen: null,
      depth: 1,
      task: false,
      writes: true,
    })
    expect(tools.filter((tool) => !tool.startsWith('hemera_')).toSorted()).toEqual(
      [...PROTOTYPER.tools].toSorted(),
    )
  })
})

describe('No stop: there is no helper_stop', () => {
  test('the role table has no tool that stops a helper', () => {
    expect(TOOL_NAMES.filter((name) => /stop/.test(name) && name !== 'commands_stop')).toEqual([])
    expect(TOOLS.helper_launch.roles).toEqual(['builder', 'helper'])
    expect(TOOLS.helper_read.roles).toEqual(['builder', 'helper'])
    expect(TOOLS.helper_result.roles).toEqual(['helper', 'prototyper'])
  })
})

describe('The brief and the names', () => {
  test('the brief says who the helper is for, its task, the Spec and its place', () => {
    const fields = helperBriefFields({
      label: 'H2',
      parentRole: 'the Builder',
      missionKey: 'ACME-1',
      depth: 1,
      brief: 'Write the CSV export.',
      task: {
        id: 'T1',
        title: 'Export as CSV',
        result: 'The invoices export as CSV.',
        targets: ['api/invoices.ts'],
        scenarios: ['R1.S1'],
      },
      spec: true,
      writes: true,
      place: 'the Workspace',
    })
    expect(fields).toEqual([
      {
        label: 'Helper H2 for the Builder of ACME-1 · depth 1',
        text: 'Write the CSV export.',
      },
      {
        label: 'Task',
        text: 'T1 Export as CSV: The invoices export as CSV; targets api/invoices.ts; scenarios R1.S1',
      },
      { label: 'Spec', text: 'spec_read (frozen)' },
      { label: 'Place', text: 'You may write: yes; your place: the Workspace' },
    ])
  })

  test('H2 reads back as 2; a stable tone per name', () => {
    expect(helperLabel(2)).toBe('H2')
    expect(helperNumberOf('H2')).toBe(2)
    expect(helperNumberOf('#2')).toBeNull()
    expect(avatarToneOf('Helper')).toBe(avatarToneOf('Helper'))
  })
})
