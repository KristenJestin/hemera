/**
 * The Home's `New Spec` (issue #128), over the whole engine as the window drives it.
 *
 * `New Spec` makes the Session `Start chat` makes, and sends the same message; what it adds is
 * the intent, which reaches the agent on that first turn as a brief behind Hemera's marker, asking
 * it to propose a Spec from the message with `spec_propose`. It is never written as the user's
 * words, and a message sent without the intent carries nothing of it. Accepting the proposal is
 * the flow a free Session already has, and is not this suite's.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { DELIVERY_MARKER } from '@hemera/core'
import { fakeAgent } from '#engine/agents/fake.ts'
import { SPEC_REQUEST, SPEC_REQUEST_URI } from '#engine/agents/spec-request.ts'
import { listenToAgents, say } from '#renderer/agent-store.ts'
import { closeSessions, openSessions, startSession } from '#renderer/sessions-store.ts'

import { type OpenWindow, install, openWindow } from './window.ts'

describe('A Session started with New Spec asks its agent for a Spec proposal', () => {
  let dataFolder: string
  let main: string
  let opened: OpenWindow | null = null
  let stops: (() => void)[] = []

  beforeEach(() => {
    dataFolder = mkdtempSync(join(tmpdir(), 'hemera-new-spec-'))
    main = realpathSync(mkdtempSync(join(tmpdir(), 'hemera-new-spec-main-')))
  })

  afterEach(async () => {
    for (const stop of stops) stop()
    stops = []
    closeSessions()
    await opened?.close()
    opened = null
    for (const folder of [dataFolder, main]) rmSync(folder, { recursive: true, force: true })
  })

  test('the first turn carries the request, behind the marker, before the message', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'A question first.' }] })
    opened = await openWindow(dataFolder, agent)
    install(opened.bridge)
    stops = [listenToAgents()]
    const project = await opened.bridge.invoke('projects.create', {
      name: 'Atlas',
      tone: 'primary',
      mainPath: main,
    })
    await openSessions(project.id)

    const made = await startSession(project.id, 'claude', null)
    expect(made).not.toBeNull()
    expect(await say(made?.id ?? '', 'Export the invoices with HT and TTC', 'spec')).toBeNull()

    // Claude takes the base as its system prompt: what the first prompt carries is the request
    // alone, as something Hemera provides, then the user's words as they wrote them.
    expect(agent.answers.blocks[0]).toEqual([
      { type: 'text', text: DELIVERY_MARKER },
      {
        type: 'resource',
        resource: { uri: SPEC_REQUEST_URI, mimeType: 'text/markdown', text: SPEC_REQUEST },
      },
      { type: 'text', text: 'Export the invoices with HT and TTC' },
    ])
    expect(SPEC_REQUEST).toContain('`spec_propose`, kind `spec`')

    // The next message is a message like any other.
    expect(await say(made?.id ?? '', 'The HT first')).toBeNull()
    expect(agent.answers.blocks[1]).toEqual([{ type: 'text', text: 'The HT first' }])

    // The Session stays free: it is accepting the proposal that turns it `define`, as it always did.
    const [session] = await opened.bridge.invoke('sessions.list', { projectId: project.id })
    expect(session?.mission).toBe('free')
  })

  test('a Session started with Start chat carries no request', async () => {
    const agent = fakeAgent({ steps: [{ does: 'says', text: 'Sure.' }] })
    opened = await openWindow(dataFolder, agent)
    install(opened.bridge)
    stops = [listenToAgents()]
    const project = await opened.bridge.invoke('projects.create', {
      name: 'Atlas',
      tone: 'primary',
      mainPath: main,
    })
    await openSessions(project.id)

    const made = await startSession(project.id, 'claude', null)
    expect(await say(made?.id ?? '', 'Export the invoices')).toBeNull()
    expect(agent.answers.blocks[0]).toEqual([{ type: 'text', text: 'Export the invoices' }])
  })
})
