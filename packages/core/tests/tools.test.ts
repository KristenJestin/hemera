/**
 * Hemera's MCP tools as one table: the roles that have each, its gate class, what it does to the
 * world, the argument that carries its path, and its input, from which the JSON Schema an agent
 * reads is generated. And the guarantee that no tool, of this ticket or a later one, reaches Ship.
 */

import { Option, Predicate, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  ROLES,
  ROLE_PLACES,
  TOOL_NAMES,
  TOOLS,
  type Role,
  admitTool,
  hemeraToolNamed,
  TESTER_TOOLS,
  readOnlyHint,
  toolsOf,
} from '../src/domain/index.ts'
import { toToolInputSchema } from '../src/schema/index.ts'

/** A role's tools, the tester mode's two left out: every role has them, tested on their own. */
const toolsFor = (role: Role) =>
  toolsOf(role)
    .filter((tool) => !TESTER_TOOLS.includes(tool))
    .toSorted()

const MEMORY_TOOLS = [
  'memory_read',
  'now_set',
  'journal_add',
  'note_add',
  'notes_condense',
  'evidence_add',
] as const

describe('The cold read and the two reviewers get no Memory (CT-06)', () => {
  test.each<Role>(['cold-read', 'spec-reviewer', 'code-reviewer'])(
    '%s has no Memory tool',
    (role) => {
      expect(toolsOf(role).filter((name) => MEMORY_TOOLS.some((one) => one === name))).toEqual([])
    },
  )
})

describe('The living spec agent reads no Memory, and no tool validates its proposals (#93)', () => {
  test('it has no Memory tool', () => {
    expect(
      toolsOf('living-spec').filter((name) => MEMORY_TOOLS.some((one) => one === name)),
    ).toEqual([])
  })

  test('no tool of any role validates, rejects or drops: that is the user’s alone', () => {
    expect(TOOL_NAMES.filter((name) => /validat|reject|drop/.test(name))).toEqual([])
    expect(
      TOOL_NAMES.filter((name) => name.startsWith('living_') && TOOLS[name].effect === 'records'),
    ).toEqual([])
  })

  test('only the living spec agent proposes, and the Planner, the Chat and it read', () => {
    expect(
      TOOL_NAMES.filter((name) => name.startsWith('living_')).map((name) => [
        name,
        TOOLS[name].roles,
      ]),
    ).toEqual([
      ['living_spec_read', ['planner', 'chat', 'living-spec']],
      ['living_domain_propose', ['living-spec']],
      ['living_requirement_propose', ['living-spec']],
      ['living_requirement_obsolete', ['living-spec']],
      ['living_spec_done', ['living-spec']],
    ])
  })
})

describe('Each role has exactly its tools', () => {
  test.each<[Role, ReadonlyArray<string>]>([
    [
      'planner',
      [
        'ask_wave',
        'commands_list',
        'commands_output',
        'commands_run',
        'declare_complete',
        'fs_list',
        'fs_read',
        'input_integrated',
        'journal_add',
        'living_spec_read',
        'memory_read',
        'mission_describe',
        'note_add',
        'notes_condense',
        'now_set',
        'probe_launch',
        'probe_read',
        'question_draft_message',
        'question_retire',
        'requirement_remove',
        'requirement_write',
        'search',
        'spec_read',
        'spec_write_section',
        'triage_answer',
      ],
    ],
    [
      'probe',
      [
        'commands_list',
        'commands_output',
        'commands_run',
        'commands_stop',
        'evidence_add',
        'fs_edit',
        'fs_list',
        'fs_read',
        'fs_write',
        'memory_read',
        'note_add',
        'now_set',
        'probe_report',
        'search',
      ],
    ],
    ['cold-read', ['fs_list', 'fs_read', 'search']],
    [
      'builder',
      [
        'commands_list',
        'commands_output',
        'commands_run',
        'commands_stop',
        'evidence_add',
        'fs_edit',
        'fs_list',
        'fs_read',
        'fs_write',
        'journal_add',
        'memory_read',
        'note_add',
        'notes_condense',
        'now_set',
        'search',
      ],
    ],
    [
      'helper',
      [
        'commands_list',
        'commands_output',
        'commands_run',
        'commands_stop',
        'fs_edit',
        'fs_list',
        'fs_read',
        'fs_write',
        'note_add',
        'now_set',
        'search',
      ],
    ],
    ['documenter', ['fs_edit', 'fs_list', 'fs_read', 'fs_write', 'now_set', 'search']],
    ['spec-reviewer', ['search']],
    ['code-reviewer', ['fs_read', 'search']],
    [
      'chat',
      [
        'commands_list',
        'commands_output',
        'commands_run',
        'commands_stop',
        'fs_edit',
        'fs_list',
        'fs_read',
        'fs_write',
        'living_spec_read',
        'memory_read',
        'missions_list',
        'search',
        'spec_create_draft',
      ],
    ],
    ['setup', ['fs_list', 'fs_read', 'search', 'setup_propose', 'setup_read']],
    [
      'living-spec',
      [
        'fs_list',
        'fs_read',
        'living_domain_propose',
        'living_requirement_obsolete',
        'living_requirement_propose',
        'living_spec_done',
        'living_spec_read',
        'search',
      ],
    ],
  ])('%s', (role, tools) => {
    expect(toolsFor(role)).toEqual(tools)
  })

  test('every role has a place, and the read-only ones are the Planner, the cold read, the reviewers, the setup agent and the living spec agent', () => {
    expect(ROLES.filter((role) => ROLE_PLACES[role].readOnly)).toEqual([
      'planner',
      'cold-read',
      'spec-reviewer',
      'code-reviewer',
      'setup',
      'living-spec',
    ])
    expect(ROLE_PLACES['living-spec'].kind).toBe('main-checkout')
    expect(ROLE_PLACES.planner.kind).toBe('main-checkout')
    expect(ROLE_PLACES.probe.kind).toBe('own-worktree')
    expect(ROLE_PLACES.builder.kind).toBe('workspace')
    expect(ROLE_PLACES.chat.kind).toBe('main-checkout')
  })
})

describe('The table says what each tool does to the world', () => {
  test('a local tool only reads, and a judged one writes or runs', () => {
    for (const name of TOOL_NAMES) {
      const tool = TOOLS[name]
      if (tool.gate === 'local') expect(tool.effect, name).toBe('reads')
      if (tool.gate === 'judged') expect(['writes', 'runs'], name).toContain(tool.effect)
    }
  })

  test('the Memory tools are workflow tools that never write in the place', () => {
    for (const name of MEMORY_TOOLS) {
      expect(TOOLS[name].gate, name).toBe('workflow')
      expect(['reads', 'records'], name).toContain(TOOLS[name].effect)
    }
  })

  test('read-only tools carry readOnlyHint true, the others false', () => {
    expect(TOOL_NAMES.filter((name) => readOnlyHint(name)).sort()).toEqual([
      'commands_list',
      'commands_output',
      'fs_list',
      'fs_read',
      'hemera_reports',
      'living_spec_read',
      'memory_read',
      'missions_list',
      'probe_read',
      'search',
      'setup_read',
      'spec_read',
    ])
  })

  test('a workflow tool names the argument its path is in, or says it takes none', () => {
    for (const name of TOOL_NAMES) {
      const tool = TOOLS[name]
      expect(Object.hasOwn(tool, 'path'), name).toBe(true)
      if (tool.path !== null) {
        expect(Object.keys(tool.input.fields), name).toContain(tool.path)
      }
    }
  })
})

describe('Every input schema is generated from its Schema', () => {
  test('the whole list, as an agent reads it', () => {
    const listed = TOOL_NAMES.map((name) => ({
      name,
      inputSchema: toToolInputSchema(TOOLS[name].input),
    }))
    expect(listed).toMatchSnapshot()
  })

  test('every tool has a description taken from its schema', () => {
    for (const name of TOOL_NAMES) {
      expect(toToolInputSchema(TOOLS[name].input).description, name).toMatch(/\w{3}/)
    }
  })

  test('a tool name is one the model APIs accept', () => {
    for (const name of TOOL_NAMES) expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
  })
})

/**
 * Ship is human: no tool of any ticket may push, merge, close, cancel, clean up or ship a mission.
 * The test reads the whole table, names, descriptions and field descriptions, every time.
 */
const SHIP_WORDS = /\b(ship\w*|push\w*|merg\w*|clos\w*|cancel\w*|clean\s*-?\s*up\w*|cleanup\w*)\b/i

/** `Array.isArray` does not narrow a read-only array out of a union: this does. */
const isList = (value: Schema.Json): value is Schema.JsonArray => Array.isArray(value)

const textsOf = (value: Schema.Json): ReadonlyArray<string> => {
  if (Predicate.isString(value)) return [value]
  if (isList(value)) return value.flatMap((item) => textsOf(item))
  if (value === null || Predicate.isNumber(value) || Predicate.isBoolean(value)) return []
  return Object.values(value).flatMap((item) => textsOf(item))
}

describe('No MCP tool can Ship, push, merge, close, cancel or clean up a mission', () => {
  test('no tool name, description or argument says so', () => {
    for (const name of TOOL_NAMES) {
      expect(name).not.toMatch(SHIP_WORDS)
      const schema: Schema.Json = JSON.parse(JSON.stringify(toToolInputSchema(TOOLS[name].input)))
      for (const text of textsOf(schema)) expect(text, name).not.toMatch(SHIP_WORDS)
    }
  })

  test('the words are caught however they are written', () => {
    for (const said of ['Ship it', 'git push', 'merges the branch', 'Close', 'clean up', 'cleanup'])
      expect(said).toMatch(SHIP_WORDS)
  })
})

describe('A name an agent reports is read back as the tool it designates', () => {
  test('under every prefix an agent registers it with', () => {
    expect(hemeraToolNamed('mcp__hemera__fs_read')).toBe('fs_read')
    expect(hemeraToolNamed('hemera_commands_run')).toBe('commands_run')
    expect(hemeraToolNamed('search')).toBe('search')
    expect(hemeraToolNamed('Bash')).toBeNull()
  })
})

describe('A tool is admitted for a role or refused with the reason', () => {
  test('a name Hemera has no tool for, and a tool the role does not have', () => {
    expect(admitTool('planner', toolsOf('planner'), 'fs_read')).toEqual({ admitted: true })
    expect(admitTool('planner', toolsOf('planner'), 'git_push')).toEqual({
      admitted: false,
      reason: 'refused: Hemera has no tool named git_push',
    })
    expect(admitTool('planner', toolsOf('planner'), 'fs_write')).toEqual({
      admitted: false,
      reason: 'refused: the Planner has no tool fs_write',
    })
  })
})

describe('A domain name the living spec agent proposes is one line (#93)', () => {
  const propose = Schema.decodeUnknownOption(TOOLS.living_domain_propose.input)

  test('a newline or a control character in a name is refused', () => {
    expect(Option.isNone(propose({ name: 'Billing\n## Accounts', summary: 'x' }))).toBe(true)
    expect(Option.isNone(propose({ name: 'Billing\r', summary: 'x' }))).toBe(true)
    expect(Option.isNone(propose({ name: 'Bill\u0007ing', summary: 'x' }))).toBe(true)
  })

  test('a plain name passes', () => {
    expect(Option.isSome(propose({ name: 'Billing · Exports', summary: 'x' }))).toBe(true)
  })
})
