/**
 * The world the suites about Hemera's tools run in: the engine as it starts (its real gate, MCP
 * server, runs and data folder), a Project of the suite's own with its main checkout on disk, a
 * mission, and agent sessions of any role, each with its token minted as an agent would be handed
 * it. The ports later tickets fill are handed as parts: a verdict that answers as a suite says and
 * remembers what it was asked, and a question that remembers it was asked.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import type { Role } from '@hemera/core/domain'
import { Effect, Layer } from 'effect'
import type { Schema } from 'effect'

import { HemeraEndpoint } from '../src/engine/agents/endpoint.ts'
import { openAgentSession } from '../src/engine/agents/sessions.ts'
import { createMission } from '../src/engine/missions.ts'
import { createProject } from '../src/engine/projects.ts'
import { ToolAccess, ToolGate } from '../src/engine/tools/index.ts'
import {
  type JudgedCall,
  PermissionRequests,
  type Verdict,
  Verdicts,
} from '../src/engine/tools/ports.ts'

/** A verdict that answers as told and keeps every call it was asked about. */
export const verdictsSaying = (answer: (call: JudgedCall) => Verdict) => {
  const asked: JudgedCall[] = []
  return {
    asked,
    layer: Layer.succeed(Verdicts, {
      judge: (call) =>
        Effect.sync(() => {
          asked.push(call)
          return answer(call)
        }),
    }),
  }
}

export const ALLOW: Verdict = { verdict: 'allow', by: 'suite' }

/** A human question that keeps what it was asked and answers as the default does. */
export const questionsKept = () => {
  const asked: Array<{ readonly call: JudgedCall; readonly reason: string }> = []
  return {
    asked,
    layer: Layer.succeed(PermissionRequests, {
      request: (call, reason) =>
        Effect.sync(() => {
          asked.push({ call, reason })
          return { answer: 'refused: approvals are not available yet' }
        }),
    }),
  }
}

/** The Project Acme, its main checkout in `work`, and one mission of it. */
export const acmeWithMission = (work: string) =>
  Effect.gen(function* () {
    const main = join(work, 'acme')
    mkdirSync(main, { recursive: true })
    const project = yield* createProject({ name: 'Acme', mainCheckout: main, repositories: [] })
    const mission = yield* createMission({
      projectId: project.id,
      idea: { sentence: 'Export the invoices as CSV', ticket: null },
    })
    return { project, mission, main }
  })

/** A session of a role, working in `folder`, its token minted: what its agent would be handed. */
export const sessionOf = (
  role: Role,
  folder: string,
  owner: { readonly kind: 'mission' | 'project'; readonly id: string },
) =>
  Effect.gen(function* () {
    const session = yield* openAgentSession({
      provider: 'claude',
      ownerKind: owner.kind,
      ownerId: owner.id,
      role,
      folder,
    })
    const token = yield* HemeraEndpoint.use((endpoint) => endpoint.mint(session.id))
    const grant = yield* ToolAccess.use((access) => access.byToken(token))
    if (grant === null) return yield* Effect.die(new Error('the token named no grant'))
    return { sessionId: session.id, token, grantId: grant.id }
  })

/** A call of a tool through the gate, as the server would hand it over. */
export const callTool = (
  grantId: string,
  tool: string,
  args: Schema.Json,
  callKey: string | null = null,
) => ToolGate.use((gate) => gate.call({ grantId, tool, arguments: args, callKey }))
