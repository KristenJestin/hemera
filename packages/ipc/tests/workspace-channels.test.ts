/**
 * What the settings of a Project's Workspaces send (Decided 17), and what the engine pushes when
 * a Workspace changes (D8-05).
 *
 * The engine reads null as the default — Hemera's own folder, the Project's name as a slug —
 * and a field the user cleared is sent as it reads: empty, or a few spaces. The declaration is
 * where the two meet, so it is what is under test here.
 */

import { describe, expect, test } from 'vite-plus/test'

import { CHANNELS, ENGINE_EVENTS, ENGINE_REQUESTS } from '#index.ts'

const ROOT = ENGINE_REQUESTS['projects.setWorkspacesRoot'].arguments
const PREFIX = ENGINE_REQUESTS['projects.setBranchPrefix'].arguments

describe('A blank workspaces folder or prefix is the default', () => {
  test.each(['', '   ', '\t \n'])('a workspaces folder of %j crosses as null', (path) => {
    expect(ROOT.parse({ id: 'atlas', version: 1, path })).toEqual({
      id: 'atlas',
      version: 1,
      path: null,
    })
  })

  test.each(['', '   ', '\t \n'])('a branch prefix of %j crosses as null', (prefix) => {
    expect(PREFIX.parse({ id: 'atlas', version: 1, prefix })).toEqual({
      id: 'atlas',
      version: 1,
      prefix: null,
    })
  })

  test('null stays null, and a value crosses as it was written for the engine to check', () => {
    expect(ROOT.parse({ id: 'atlas', version: 1, path: null }).path).toBeNull()
    expect(ROOT.parse({ id: 'atlas', version: 1, path: ' /srv/workspaces ' }).path).toBe(
      ' /srv/workspaces ',
    )
    expect(PREFIX.parse({ id: 'atlas', version: 1, prefix: 'hemera' }).prefix).toBe('hemera')
  })

  test('the window sends through the very same reading', () => {
    expect(CHANNELS['projects.setWorkspacesRoot'].arguments).toBe(ROOT)
    expect(CHANNELS['projects.setBranchPrefix'].arguments).toBe(PREFIX)
  })
})

describe('A Workspace change is pushed about its Project', () => {
  test('a change names the Project and the Workspace, and no Session', () => {
    expect(
      ENGINE_EVENTS.workspace.safeParse({
        event: 'workspace',
        projectId: 'atlas',
        workspaceId: 'login-form',
      }).success,
    ).toBe(true)
    expect(
      ENGINE_EVENTS.workspace.safeParse({ event: 'workspace', sessionId: 'session-1' }).success,
    ).toBe(false)
  })
})
