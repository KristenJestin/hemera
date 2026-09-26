/**
 * The Spec contract on the wire (D7-01, D7-10): what the panel is handed, what it may ask, and
 * what the engine pushes when a Spec changed.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  CHANNELS,
  ENGINE_EVENTS,
  ENGINE_REQUESTS,
  SPEC_REQUESTS,
  sessionEntrySchema,
  sessionSchema,
  specQuestionSchema,
  specSnapshotSchema,
  type SpecSnapshot,
} from '#index.ts'

const SNAPSHOT: SpecSnapshot = {
  spec: {
    id: 'spec-1',
    projectId: 'project-1',
    key: 'HEM-1',
    slug: 'export-the-journal',
    status: 'draft',
    priority: null,
    workspaceId: null,
    currentRevisionId: 'revision-1',
    writerSessionId: 'session-1',
    contentVersion: 3,
    createdAt: 1,
    updatedAt: 2,
  },
  revision: {
    id: 'revision-1',
    specId: 'spec-1',
    number: 1,
    title: 'Export the Journal',
    type: 'feature',
    changeSummary: null,
    changeReason: null,
    createdBy: 'agent',
    attestedContentVersion: null,
    createdAt: 1,
  },
  sections: [
    {
      id: 'section-1',
      revisionId: 'revision-1',
      name: 'problem',
      body: 'The Journal cannot leave the application.',
      version: 1,
      author: 'human',
      sessionId: 'session-1',
      updatedAt: 2,
    },
  ],
  stories: [
    {
      id: 'story-1',
      revisionId: 'revision-1',
      title: 'Export',
      narrative: 'As a user I export the Journal.',
      priority: 'must',
      rank: 'a0',
    },
  ],
  criteria: [{ id: 'criterion-1', storyId: 'story-1', body: 'A file is written.', rank: 'a0' }],
  tasks: [
    {
      id: 'task-1',
      taskSetId: 'set-1',
      title: 'Write the file',
      result: 'A CSV file',
      type: 'code',
      executor: 'agent',
      criteria: 'The file opens.',
      rank: 'a0',
    },
  ],
  dependencies: [],
  taskStories: [{ taskId: 'task-1', storyId: 'story-1' }],
  questions: [
    {
      id: 'question-1',
      revisionId: 'revision-1',
      body: 'Which format?',
      blocking: true,
      phase: 'shape',
      raisedBy: 'agent',
      options: [
        { id: 'csv', label: 'CSV', recommended: true },
        { id: 'json', label: 'JSON' },
      ],
      answer: null,
      resolvedAt: null,
    },
  ],
  briefedAt: null,
  phases: [
    {
      id: 'phase-1',
      revisionId: 'revision-1',
      phase: 'shape',
      state: 'finished',
      summary: 'Shaped.',
      assumptions: ['CSV is enough'],
      basis: { problem: 1 },
      protocolVersion: 1,
      declaredAt: 2,
    },
    {
      id: 'phase-2',
      revisionId: 'revision-1',
      phase: 'prototype',
      state: 'unavailable',
      summary: null,
      assumptions: [],
      basis: {},
      protocolVersion: 1,
      declaredAt: null,
    },
  ],
}

describe('The Spec contract crosses the wire', () => {
  test('a full snapshot parses', () => {
    expect(specSnapshotSchema.safeParse(SNAPSHOT).success).toBe(true)
    expect(ENGINE_REQUESTS['specs.read'].response.safeParse(SNAPSHOT).success).toBe(true)
  })

  test('a section the contract does not name is refused', () => {
    expect(
      specSnapshotSchema.safeParse({
        ...SNAPSHOT,
        sections: [{ ...SNAPSHOT.sections[0], name: 'appendix' }],
      }).success,
    ).toBe(false)
  })

  test('a Session says its mission and the Spec it defines', () => {
    const session = {
      id: 'session-1',
      projectId: 'project-1',
      title: 'Define the export',
      titleSource: 'user',
      provider: 'claude',
      model: null,
      nativeState: 'none',
      workspaceId: null,
      workspaceFixed: false,
      mission: 'define',
      specId: 'spec-1',
      archivedAt: null,
      createdAt: 1,
      lastWrittenAt: 1,
      version: 1,
    }
    expect(sessionSchema.safeParse(session).success).toBe(true)
    expect(sessionSchema.safeParse({ ...session, mission: 'explore' }).success).toBe(false)
  })

  test('no request sets a mission: a Session turns define by creating or opening a Spec', () => {
    expect(Object.keys(ENGINE_REQUESTS)).not.toContain('sessions.setMission')
    expect(Object.keys(ENGINE_REQUESTS)).not.toContain('specs.join')
    expect(
      ENGINE_REQUESTS['specs.openSession'].arguments.safeParse({ specId: 'spec-1' }).success,
    ).toBe(false)
  })

  test('the thread holds the brief, the questions, the answers and the proposal', () => {
    for (const kind of ['mission_brief', 'spec_question', 'spec_answer', 'spec_proposal']) {
      expect(sessionEntrySchema.shape.kind.safeParse(kind).success).toBe(true)
    }
  })
})

describe('A question offers options and takes one of them or a text', () => {
  const answer = ENGINE_REQUESTS['specs.answerQuestion'].arguments

  test('an answered question carries its options and the answer given', () => {
    const answered = {
      ...SNAPSHOT.questions[0],
      answer: { optionId: 'csv', text: null },
      resolvedAt: 3,
    }
    expect(specQuestionSchema.safeParse(answered).success).toBe(true)
  })

  test('an answer names an option or a text', () => {
    expect(answer.safeParse({ specId: 's', questionId: 'q', optionId: 'csv' }).success).toBe(true)
    expect(answer.safeParse({ specId: 's', questionId: 'q', text: 'Both' }).success).toBe(true)
  })

  test('Rework takes a reason or none, and names the Session it came from', () => {
    const reopen = ENGINE_REQUESTS['specs.reopen'].arguments
    const asked = { specId: 's', expectedRevisionId: 'r', sessionId: 'writer' }
    expect(reopen.safeParse(asked).success).toBe(true)
    expect(reopen.safeParse({ ...asked, reason: 'CSV' }).success).toBe(true)
    expect(reopen.safeParse({ specId: 's', expectedRevisionId: 'r' }).success).toBe(false)
  })
})

describe('Mark ready is sent with the content it was shown', () => {
  const markReady = ENGINE_REQUESTS['specs.markReady'].arguments

  test('a click carries the revision, the content version and the Session it came from', () => {
    const clicked = {
      specId: 'spec-1',
      expectedRevisionId: 'revision-1',
      expectedContentVersion: 3,
    }
    expect(markReady.safeParse({ ...clicked, sessionId: 'writer' }).success).toBe(true)
    expect(markReady.safeParse(clicked).success).toBe(false)
  })

  test('a negative content version is refused', () => {
    expect(
      markReady.safeParse({
        specId: 'spec-1',
        expectedRevisionId: 'revision-1',
        expectedContentVersion: -1,
        sessionId: 'writer',
      }).success,
    ).toBe(false)
  })
})

describe('A Spec change is pushed', () => {
  test('spec.changed says which Spec of which Project, and carries no id', () => {
    const pushed = { event: 'spec.changed', specId: 'spec-1', projectId: 'project-1' }
    const read = ENGINE_EVENTS.spec_changed.safeParse(pushed)

    expect(read.success).toBe(true)
    // An answer is told from an event by its top-level `id`: a pushed event never has one.
    expect(read.data !== undefined && 'id' in read.data).toBe(false)
    expect(ENGINE_EVENTS.spec_changed.shape).not.toHaveProperty('id')
  })
})

describe('The Spec use cases are declared and relayed', () => {
  test('every use case of the plan is declared, and each is a channel of the same name', () => {
    const names = [
      'specs.list',
      'specs.read',
      'specs.revisions',
      'specs.writeSection',
      'specs.writeStories',
      'specs.writeTasks',
      'specs.raiseQuestion',
      'specs.answerQuestion',
      'specs.markReady',
      'specs.reopen',
      'specs.transferWrite',
      'specs.buffers.read',
      'specs.buffers.save',
      'specs.buffers.discard',
      // The Workspace a Spec's build runs in, written on the Spec when it is made ready (D8-12).
      'specs.useWorkspace',
    ]
    const declared = Object.keys(ENGINE_REQUESTS).filter((name) => name.startsWith('specs.'))
    const relayed = Object.keys(CHANNELS).filter((name) => name.startsWith('specs.'))

    const withSession = [...names, 'specs.create', 'specs.declineProposal', 'specs.openSession']

    expect(Object.keys(SPEC_REQUESTS).toSorted()).toEqual(names.toSorted())
    expect(declared.toSorted()).toEqual(withSession.toSorted())
    expect(relayed.toSorted()).toEqual(withSession.toSorted())
  })
})
