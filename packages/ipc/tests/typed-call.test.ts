import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import {
  CHANNELS,
  type ChannelName,
  ENGINE_REQUESTS,
  type EngineRequestName,
  windowCommandSchema,
} from '#index.ts'

const ipc = resolve(import.meta.dirname, '..')

/**
 * What a call is written against: the bridge the page is handed, and the way the main process
 * asks the process that holds the database. Neither is implemented here — a declaration is
 * what is under test, so a signature is all a probe needs to be written against.
 */
const CALLERS = [
  "import type { Bridge, EngineArguments, EngineRequestName, EngineResponse } from '../../src/index.ts'",
  '',
  'declare const bridge: Bridge',
  'declare function ask<K extends EngineRequestName>(',
  '  name: K,',
  '  argument: EngineArguments<K>,',
  '): Promise<EngineResponse<K>>',
]

/**
 * Type checks one call against the declaration and answers what the compiler said.
 *
 * The compiler is the thing under test, so it is run rather than imitated: a call written in
 * a file, `tsc` over that file, and whatever it reports.
 */
function compile(call: string) {
  const probe = join(ipc, 'tests', '.probe')
  mkdirSync(probe, { recursive: true })
  writeFileSync(join(probe, 'call.ts'), [...CALLERS, call].join('\n').concat('\n'))
  writeFileSync(
    join(probe, 'tsconfig.json'),
    `${JSON.stringify(
      {
        extends: '../../../../tsconfig.base.json',
        compilerOptions: { types: [] },
        include: ['call.ts'],
      },
      null,
      2,
    )}\n`,
  )
  try {
    const result = spawnSync(`tsc -p "${join(probe, 'tsconfig.json')}"`, {
      cwd: ipc,
      encoding: 'utf8',
      shell: true,
    })
    return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` }
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

describe('Appel typé nominal', () => {
  test('the channels of the application are the ones declared', () => {
    const names: ChannelName[] = [
      'env.report',
      'preferences.read',
      'preferences.write',
      'window.command',
      // Relayed to the engine, one channel per use case of the same name.
      'engine.status',
      'projects.list',
      'projects.create',
      'projects.update',
      'projects.moveMain',
      'projects.archive',
      'projects.restore',
      'repositories.add',
      'repositories.remove',
      'projects.setWorkspacesRoot',
      'projects.setBranchPrefix',
      'projects.setRepositoryIncluded',
      'journal.read',
      'journal.unseen',
      'journal.markSeen',
      'sessions.list',
      'sessions.create',
      'sessions.rename',
      'sessions.chooseWorkspace',
      'sessions.archive',
      'sessions.restore',
      'sessions.append',
      'sessions.read',
      // The agents, relayed to the engine the same way.
      'agents.list',
      'agents.offer',
      'agents.offerSet',
      'agents.options',
      'agents.setOption',
      'agents.prompt',
      'agents.stop',
      'agents.decide',
      'agents.resume',
      'agents.check',
      'agents.update',
      'commands.create',
      'commands.list',
      'commands.output',
      'commands.services',
      'commands.proposeAccept',
      'commands.proposeDecline',
      'commands.remove',
      'commands.run',
      'commands.runs',
      'commands.stop',
      'commands.update',
      'context.read',
      'workspaces.list',
      'workspaces.plan',
      'workspaces.create',
      'workspaces.createOnFolder',
      'workspaces.status',
      'workspaces.cleanup',
      'preparation.steps',
      'preparation.prepare',
      'preparation.resume',
      'recipe.list',
      'recipe.add',
      'recipe.remove',
      'recipe.move',
      'variables.list',
      'variables.set',
      'variables.remove',
      // Answered by the main process itself, because only it can.
      'dialog.pickFolder',
      'dialog.pickFiles',
      'shell.open',
      'repositories.status',
      'workspace.files',
      'workspace.folders',
      'workspace.check',
    ]
    expect(Object.keys(CHANNELS).toSorted()).toEqual(names.toSorted())
  })

  test('a declared channel called with conforming arguments compiles', () => {
    const result = compile("void bridge.invoke('window.command', { command: 'minimize' })")
    expect(result.output).toBe('')
    expect(result.ok).toBe(true)
  })

  test('the answer of a channel has the type the declaration gives it', () => {
    const result = compile(
      [
        "const report = await bridge.invoke('env.report', {})",
        'const version: string = report.versions.electron',
        'void version',
      ].join('\n'),
    )
    expect(result.output).toBe('')
    expect(result.ok).toBe(true)
  })

  test('the arguments schema rejects a command that is not one of the three', () => {
    expect(windowCommandSchema.safeParse({ command: 'minimize' }).success).toBe(true)
    expect(windowCommandSchema.safeParse({ command: 'explode' }).success).toBe(false)
  })
})

describe('Cas d’usage nommés du process dédié', () => {
  test('the use cases of the process that holds the database are the ones declared', () => {
    const names: EngineRequestName[] = [
      'preferences.read',
      'preferences.write',
      'engine.status',
      'projects.list',
      'projects.create',
      'projects.update',
      'projects.moveMain',
      'projects.archive',
      'projects.restore',
      'repositories.add',
      'repositories.remove',
      'projects.setWorkspacesRoot',
      'projects.setBranchPrefix',
      'projects.setRepositoryIncluded',
      'journal.read',
      'journal.unseen',
      'journal.markSeen',
      'sessions.list',
      'sessions.create',
      'sessions.rename',
      'sessions.chooseWorkspace',
      'sessions.archive',
      'sessions.restore',
      'sessions.append',
      'sessions.read',
      'agents.list',
      'agents.offer',
      'agents.offerSet',
      'agents.options',
      'agents.setOption',
      'agents.prompt',
      'agents.stop',
      'agents.decide',
      'agents.resume',
      'agents.check',
      'agents.update',
      'commands.create',
      'commands.list',
      'commands.output',
      'commands.services',
      'commands.proposeAccept',
      'commands.proposeDecline',
      'commands.remove',
      'commands.run',
      'commands.runs',
      'commands.stop',
      'commands.update',
      'context.read',
      'workspaces.list',
      'workspaces.plan',
      'workspaces.create',
      'workspaces.createOnFolder',
      'workspaces.status',
      'workspaces.cleanup',
      'preparation.steps',
      'preparation.prepare',
      'preparation.resume',
      'recipe.list',
      'recipe.add',
      'recipe.remove',
      'recipe.move',
      'variables.list',
      'variables.set',
      'variables.remove',
    ]
    expect(Object.keys(ENGINE_REQUESTS).toSorted()).toEqual(names.toSorted())
  })

  test('a declared use case called with conforming arguments compiles', () => {
    const result = compile("void ask('preferences.write', { theme: 'dark' })")
    expect(result.output).toBe('')
    expect(result.ok).toBe(true)
  })

  test('the answer of a use case has the type the declaration gives it', () => {
    const result = compile(
      [
        "const status = await ask('engine.status', {})",
        'const writer: string | null = status.writtenByVersion',
        'void writer',
      ].join('\n'),
    )
    expect(result.output).toBe('')
    expect(result.ok).toBe(true)
  })

  test('an agent use case is called and answered like any other', () => {
    const result = compile(
      [
        "const over = await ask('agents.prompt', { sessionId: 'session-1', text: 'read it' })",
        'const reason: string = over.stopReason',
        'void reason',
      ].join('\n'),
    )
    expect(result.output).toBe('')
    expect(result.ok).toBe(true)
  })
})

describe('Cas d’usage non déclaré', () => {
  test('a use case name the declaration does not carry does not compile', () => {
    const result = compile("void ask('engine.staus', {})")
    expect(result.ok).toBe(false)
    expect(result.output).toContain('engine.staus')
  })

  test('a declared use case called with the wrong argument type does not compile', () => {
    const result = compile("void ask('preferences.write', { theme: 'sepia' })")
    expect(result.ok).toBe(false)
    expect(result.output).toContain('sepia')
  })
})

describe('Canal non déclaré', () => {
  test('a channel name the declaration does not carry does not compile', () => {
    const result = compile("void bridge.invoke('env.reoprt', {})")
    expect(result.ok).toBe(false)
    expect(result.output).toContain('env.reoprt')
  })

  test('a declared channel called with the wrong argument type does not compile', () => {
    const result = compile("void bridge.invoke('window.command', { command: 'explode' })")
    expect(result.ok).toBe(false)
    expect(result.output).toContain('explode')
  })

  test('an answer used as the wrong type does not compile', () => {
    const result = compile(
      [
        "const report = await bridge.invoke('env.report', {})",
        'const displays: number = report.displays',
        'void displays',
      ].join('\n'),
    )
    expect(result.ok).toBe(false)
    expect(result.output).toContain("is not assignable to type 'number'")
  })
})
