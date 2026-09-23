/**
 * The text side of the `define` protocol (design D7-09): the briefs, the Spec as Markdown and
 * the block that precedes a `define` turn.
 */

import { describe, expect, test } from 'vite-plus/test'

import { DEFINE_MISSION_BRIEF, PHASE_BRIEFS, composeBrief, renderSpecMarkdown } from '#index.ts'

import { passingSnapshot, section } from './spec-fixture.ts'

describe('The brief of a define turn', () => {
  test('the block starts with the mission and the focused phase’s brief', () => {
    const block = composeBrief({
      snapshot: passingSnapshot(),
      focus: 'shape',
      humanEdits: [],
      answers: [],
    })
    expect(block.startsWith(`${DEFINE_MISSION_BRIEF}\n\n${PHASE_BRIEFS.shape}`)).toBe(true)
  })

  test('it carries the Spec with the version of each section', () => {
    const snapshot = passingSnapshot()
    const block = composeBrief({ snapshot, focus: 'plan', humanEdits: [], answers: [] })
    expect(block).toContain(renderSpecMarkdown(snapshot))
    expect(block).toContain('## scope\n<!-- version: 1 -->\nPDF only.')
    expect(block).not.toContain('Human edits')
  })

  test('it ends with the human edits since the last turn, each with its name and version', () => {
    const scope = { ...section('scope', 'PDF and CSV.', 3), author: 'human' as const }
    const block = composeBrief({
      snapshot: passingSnapshot(),
      focus: 'plan',
      humanEdits: [scope],
      answers: [],
    })
    expect(
      block.endsWith('# Human edits since your last turn\n\n## scope · version 3\n\nPDF and CSV.'),
    ).toBe(true)
  })

  test('it lists the answers given since the last turn, in the user’s words', () => {
    const snapshot = passingSnapshot()
    const text = { ...snapshot.questions[0]!, answer: { optionId: null, text: 'Tabloid' } }
    const block = composeBrief({
      snapshot,
      focus: 'plan',
      humanEdits: [],
      answers: [snapshot.questions[0]!, text],
    })
    expect(
      block.endsWith(
        '# Answers since your last turn\n\n- Which paper size?\n  The user answered: A4\n- Which paper size?\n  The user answered: Tabloid',
      ),
    ).toBe(true)
  })

  test('with no phase in focus it says so instead of a phase brief', () => {
    const block = composeBrief({
      snapshot: passingSnapshot(),
      focus: null,
      humanEdits: [],
      answers: [],
    })
    expect(block).toContain('# Phase: none')
  })
})

describe('The Spec rendered for the agent', () => {
  test('it names the key, the type, the status and the revision', () => {
    expect(renderSpecMarkdown(passingSnapshot())).toContain(
      '# HEM-7 · Export a report\n\nType: feature · Status: draft · Revision: 1 · Content version: 10',
    )
  })

  test('it lists stories with ordered criteria, tasks with their links, and open questions only', () => {
    const complete = passingSnapshot()
    const snapshot = {
      ...complete,
      criteria: [
        ...complete.criteria,
        { id: 'criterion-0', storyId: 'story-1', body: 'A file is chosen.', rank: 'a' },
      ],
      questions: [
        ...complete.questions,
        { ...complete.questions[0]!, id: 'question-2', body: 'Landscape?', resolvedAt: null },
      ],
    }
    const markdown = renderSpecMarkdown(snapshot)
    expect(markdown).toContain('1. A file is chosen.\n2. A PDF is written.')
    expect(markdown).toContain('Depends on: Render\nCovers: Export')
    expect(markdown).toContain('- [blocking] Landscape? (shape) Options: A4 (recommended), Letter.')
    expect(markdown).not.toContain('Which paper size?')
  })
})

describe('The phase briefs', () => {
  test('prototype is unavailable in this version', () => {
    expect(PHASE_BRIEFS.prototype).toContain('Unavailable in this version')
  })

  test('shape interviews one question at a time with a recommendation', () => {
    expect(PHASE_BRIEFS.shape).toContain('a single question at a time')
    expect(DEFINE_MISSION_BRIEF).toContain('You never freeze the Spec')
  })
})
