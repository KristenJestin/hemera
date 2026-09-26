/**
 * The `define` protocol's text side (D7-09): the Spec rendered for the agent, the mission brief
 * Hemera hands a `define` Session's agent, and the human edits and answers it hands over between
 * two briefs.
 */

import { compareRanks } from '../../domain/rank.ts'
import { SECTION_NAMES, answerWords } from '../../domain/spec.ts'
import type { PhaseId, SpecQuestion, SpecSection, SpecSnapshot } from '../../domain/spec.ts'
import { DEFINE_MISSION_BRIEF, PHASE_BRIEFS } from './briefs.ts'

export { DEFINE_MISSION_BRIEF, PHASE_BRIEFS, QUESTION_RULE } from './briefs.ts'

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
  /**
   * What the writer Session is called when this Session only reads the Spec (D7-11, Decided 17);
   * absent for the writer.
   */
  readsFrom?: string | undefined
}

/** The line a reader's brief opens with: it reads, and who writes (Decided 17). */
export function readerLine(key: string, writer: string): string {
  return `You read ${key}: the Session "${writer}" writes it, and your writes to it are refused.`
}

/** The human edits the agent was not told of yet, each with its section, version and body. */
export function editsText(humanEdits: readonly SpecSection[]): string {
  const edits = humanEdits.map(
    (section) => `## ${section.name} · version ${section.version}\n\n${section.body}`,
  )
  return `# Human edits since your last turn\n\n${edits.join('\n\n')}`
}

/** The answers the user gave in the chat that the agent was not told of yet. */
export function answersText(answers: readonly SpecQuestion[]): string {
  const given = answers.map(
    (question) => `- ${question.body}\n  The user answered: ${answerWords(question) ?? ''}`,
  )
  return `# Answers since your last turn\n\n${given.join('\n')}`
}

/**
 * The mission brief of a `define` Session (D7-09), handed to its agent as a delivery: the
 * mission's instructions, the focused phase's brief, the Spec with its section versions, then the
 * human edits and the answers given in the chat that the agent was not told of yet. A reader's
 * brief opens with one line saying it reads and naming the writer.
 */
export function composeBrief({
  snapshot,
  focus,
  humanEdits,
  answers,
  readsFrom,
}: BriefInput): string {
  const parts = [
    DEFINE_MISSION_BRIEF,
    focus === null
      ? '# Phase: none\n\nNo phase is open: every activated phase is finished. Keep the Spec consistent and wait for the user.'
      : PHASE_BRIEFS[focus],
    `# The Spec\n\n${renderSpecMarkdown(snapshot)}`,
  ]
  if (readsFrom !== undefined) parts.unshift(readerLine(snapshot.spec.key, readsFrom))
  if (humanEdits.length > 0) parts.push(editsText(humanEdits))
  if (answers.length > 0) parts.push(answersText(answers))
  return parts.join('\n\n')
}
