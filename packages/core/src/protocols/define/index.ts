/**
 * The `define` protocol's text side (D7-09): the Spec rendered for the agent, and the block
 * Hemera puts before each turn of a `define` Session.
 */

import { compareRanks } from '../../domain/rank.ts'
import { SECTION_NAMES, answerWords } from '../../domain/spec.ts'
import type { PhaseId, SpecQuestion, SpecSection, SpecSnapshot } from '../../domain/spec.ts'
import { DEFINE_MISSION_BRIEF, PHASE_BRIEFS } from './briefs.ts'

export { DEFINE_MISSION_BRIEF, PHASE_BRIEFS } from './briefs.ts'

function byRank<T extends { rank: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => compareRanks(left.rank, right.rank))
}

/**
 * One revision of a Spec as Markdown: its key, type, status and revision, each section with its
 * `<!-- version: n -->`, the stories with their ordered criteria, the tasks with their
 * dependencies and covered stories, the phases and the open questions.
 */
export function renderSpecMarkdown(snapshot: SpecSnapshot): string {
  const { spec, revision } = snapshot
  const lines = [
    `# ${spec.key} · ${revision.title}`,
    '',
    `Type: ${revision.type} · Status: ${spec.status} · Revision: ${revision.number} · Content version: ${spec.contentVersion}`,
  ]

  for (const name of SECTION_NAMES) {
    const section = snapshot.sections.find((candidate) => candidate.name === name)
    if (section === undefined) continue
    lines.push('', `## ${name}`, `<!-- version: ${section.version} -->`, section.body)
  }

  if (snapshot.stories.length > 0) {
    lines.push('', '## Stories')
    for (const story of byRank(snapshot.stories)) {
      const priority = story.priority === null ? '' : ` (${story.priority})`
      lines.push('', `### ${story.title}${priority}`, story.narrative)
      byRank(snapshot.criteria.filter((criterion) => criterion.storyId === story.id)).forEach(
        (criterion, index) => lines.push(`${index + 1}. ${criterion.body}`),
      )
    }
  }

  if (snapshot.tasks.length > 0) {
    const titles = new Map(snapshot.tasks.map((task) => [task.id, task.title]))
    const stories = new Map(snapshot.stories.map((story) => [story.id, story.title]))
    lines.push('', '## Tasks')
    for (const task of byRank(snapshot.tasks)) {
      const dependsOn = snapshot.dependencies
        .filter((dependency) => dependency.taskId === task.id)
        .map((dependency) => titles.get(dependency.dependsOnId) ?? dependency.dependsOnId)
      const covers = snapshot.taskStories
        .filter((link) => link.taskId === task.id)
        .map((link) => stories.get(link.storyId) ?? link.storyId)
      lines.push('', `### ${task.title}`, `Type: ${task.type} · Executor: ${task.executor}`)
      lines.push(`Result: ${task.result}`, `Criteria: ${task.criteria}`)
      if (dependsOn.length > 0) lines.push(`Depends on: ${dependsOn.join(', ')}`)
      if (covers.length > 0) lines.push(`Covers: ${covers.join(', ')}`)
    }
  }

  if (snapshot.phases.length > 0) {
    lines.push('', '## Phases')
    for (const phase of snapshot.phases) lines.push(`- ${phase.phase}: ${phase.state}`)
  }

  const open = snapshot.questions.filter((question) => question.resolvedAt === null)
  if (open.length > 0) {
    lines.push('', '## Open questions')
    for (const question of open) {
      const scope = question.phase === null ? '' : ` (${question.phase})`
      const options = question.options.map(
        (option) => `${option.label}${option.recommended === true ? ' (recommended)' : ''}`,
      )
      const offered = options.length === 0 ? '' : ` Options: ${options.join(', ')}.`
      lines.push(`- ${question.blocking ? '[blocking] ' : ''}${question.body}${scope}${offered}`)
    }
  }

  return lines.join('\n')
}

/** What a turn's brief is composed from. */
export interface BriefInput {
  snapshot: SpecSnapshot
  /** The phase in focus, from `focusOf`; null when none is open or stale. */
  focus: PhaseId | null
  /** The sections a human wrote since the last brief. */
  humanEdits: readonly SpecSection[]
  /** The questions the human answered since the last brief (D7-01, D7-09). */
  answers: readonly SpecQuestion[]
}

/**
 * The block that precedes the text of a `define` turn (D7-09): the mission's instructions, the
 * focused phase's brief, the Spec with its section versions, then the human edits since the
 * last turn, each with its section, version and body, and the answers given in the chat since.
 */
export function composeBrief({ snapshot, focus, humanEdits, answers }: BriefInput): string {
  const parts = [
    DEFINE_MISSION_BRIEF,
    focus === null
      ? '# Phase: none\n\nNo phase is open: every activated phase is finished. Keep the Spec consistent and wait for the user.'
      : PHASE_BRIEFS[focus],
    `# The Spec\n\n${renderSpecMarkdown(snapshot)}`,
  ]
  if (humanEdits.length > 0) {
    const edits = humanEdits.map(
      (section) => `## ${section.name} · version ${section.version}\n\n${section.body}`,
    )
    parts.push(`# Human edits since your last turn\n\n${edits.join('\n\n')}`)
  }
  if (answers.length > 0) {
    const given = answers.map(
      (question) => `- ${question.body}\n  The user answered: ${answerWords(question) ?? ''}`,
    )
    parts.push(`# Answers since your last turn\n\n${given.join('\n')}`)
  }
  return parts.join('\n\n')
}
