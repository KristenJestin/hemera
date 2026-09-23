/**
 * A `feature` Spec that passes the ready gate: every section, one story covered by a criterion
 * and a task, two tasks in order, no open blocking question, the three phases finished on the
 * current sections, `prototype` unavailable and a current attestation. Each test takes one
 * element away.
 */

import type { SpecSection, SpecSnapshot } from '#index.ts'

export function section(name: SpecSection['name'], body: string, version = 1): SpecSection {
  return {
    id: `section-${name}`,
    revisionId: 'revision-1',
    name,
    body,
    version,
    author: 'agent',
    sessionId: 'session-1',
    updatedAt: 0,
  }
}

export function passingSnapshot(): SpecSnapshot {
  return {
    spec: {
      id: 'spec-1',
      projectId: 'project-1',
      key: 'HEM-7',
      slug: 'export-a-report',
      status: 'draft',
      priority: null,
      workspaceId: null,
      currentRevisionId: 'revision-1',
      writerSessionId: 'session-1',
      contentVersion: 10,
      createdAt: 0,
      updatedAt: 0,
    },
    revision: {
      id: 'revision-1',
      specId: 'spec-1',
      number: 1,
      title: 'Export a report',
      type: 'feature',
      changeSummary: null,
      changeReason: null,
      createdBy: 'human',
      attestedContentVersion: 10,
      createdAt: 0,
    },
    sections: [
      section('problem', 'Reports cannot leave the app.'),
      section('expected_outcome', 'A report exports as PDF.'),
      section('scope', 'PDF only.'),
      section('verification', 'Export one and open it.'),
      section('behaviour', 'The Export button writes a PDF.'),
      section('plan', 'Render with the print API.'),
    ],
    stories: [
      {
        id: 'story-1',
        revisionId: 'revision-1',
        title: 'Export',
        narrative: 'As a user I export a report.',
        priority: null,
        rank: 'i',
      },
    ],
    criteria: [{ id: 'criterion-1', storyId: 'story-1', body: 'A PDF is written.', rank: 'i' }],
    tasks: [
      {
        id: 'task-1',
        taskSetId: 'set-1',
        title: 'Render',
        result: 'A PDF renderer',
        type: 'feature',
        executor: 'agent',
        criteria: 'Renders a page',
        rank: 'i',
      },
      {
        id: 'task-2',
        taskSetId: 'set-1',
        title: 'Button',
        result: 'The Export button',
        type: 'feature',
        executor: 'agent',
        criteria: 'Clicking exports',
        rank: 'r',
      },
    ],
    dependencies: [{ taskId: 'task-2', dependsOnId: 'task-1' }],
    taskStories: [{ taskId: 'task-2', storyId: 'story-1' }],
    questions: [
      {
        id: 'question-1',
        revisionId: 'revision-1',
        body: 'Which paper size?',
        blocking: true,
        phase: 'shape',
        raisedBy: 'agent',
        options: [
          { id: 'a4', label: 'A4', recommended: true },
          { id: 'letter', label: 'Letter' },
        ],
        answer: { optionId: 'a4', text: null },
        resolvedAt: 1,
      },
    ],
    phases: [
      {
        id: 'phase-shape',
        revisionId: 'revision-1',
        phase: 'shape',
        state: 'finished',
        summary: 'Framed.',
        assumptions: [],
        basis: { problem: 1, expected_outcome: 1, scope: 1, verification: 1, behaviour: 1 },
        protocolVersion: 1,
        declaredAt: 1,
      },
      {
        id: 'phase-plan',
        revisionId: 'revision-1',
        phase: 'plan',
        state: 'finished',
        summary: 'Planned.',
        assumptions: [],
        basis: { plan: 1 },
        protocolVersion: 1,
        declaredAt: 1,
      },
      {
        id: 'phase-decompose',
        revisionId: 'revision-1',
        phase: 'decompose',
        state: 'finished',
        summary: 'Sliced.',
        assumptions: [],
        basis: {},
        protocolVersion: 1,
        declaredAt: 1,
      },
      {
        id: 'phase-prototype',
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
}
