/**
 * The Spec as the interface is handed one, and the use cases that read and write it (D7-01).
 *
 * Zod mirrors of `packages/core/src/domain/spec.ts`, field for field: the same closed sets and
 * the same camelCase names, dates as epoch milliseconds like every other schema of the wire.
 * The domain does not depend on `ipc` and `ipc` does not depend on the domain; the engine is the
 * one program that sees both.
 */

import { z } from 'zod'

/** What a Spec proves (D7-06). */
export const specTypeSchema = z.enum(['feature', 'bug', 'maintenance'])

export type SpecType = z.infer<typeof specTypeSchema>

/** This lot writes `draft` and `ready` only (D7-03). */
export const specStatusSchema = z.enum(['draft', 'ready', 'in_progress', 'cancelled'])

export type SpecStatus = z.infer<typeof specStatusSchema>

export const sectionNameSchema = z.enum([
  'problem',
  'expected_outcome',
  'scope',
  'verification',
  'plan',
  'behaviour',
  'reproduction',
  'invariants',
])

export type SectionName = z.infer<typeof sectionNameSchema>

export const specActorSchema = z.enum(['human', 'agent'])

export type SpecActor = z.infer<typeof specActorSchema>

export const taskExecutorSchema = z.enum(['agent', 'human'])

export type TaskExecutor = z.infer<typeof taskExecutorSchema>

/** The phases of the `define` protocol (D7-08). */
export const phaseIdSchema = z.enum(['shape', 'plan', 'decompose', 'prototype'])

export type PhaseId = z.infer<typeof phaseIdSchema>

export const phaseStateSchema = z.enum(['pending', 'open', 'finished', 'stale', 'unavailable'])

export type PhaseState = z.infer<typeof phaseStateSchema>

/** What a Session is for (D7-07); `build` is declared and not written yet. */
export const missionSchema = z.enum(['free', 'define', 'build'])

export type Mission = z.infer<typeof missionSchema>

export const specSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string(),
  slug: z.string(),
  status: specStatusSchema,
  priority: z.string().nullable(),
  workspaceId: z.string().nullable(),
  currentRevisionId: z.string(),
  writerSessionId: z.string().nullable(),
  contentVersion: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type Spec = z.infer<typeof specSchema>

/** A Spec as a list shows it: with the title and type of its current revision. */
export const specSummarySchema = specSchema.extend({ title: z.string(), type: specTypeSchema })

export type SpecSummary = z.infer<typeof specSummarySchema>

export const specRevisionSchema = z.object({
  id: z.string(),
  specId: z.string(),
  number: z.number(),
  title: z.string(),
  type: specTypeSchema,
  changeSummary: z.string().nullable(),
  changeReason: z.string().nullable(),
  createdBy: specActorSchema,
  attestedContentVersion: z.number().nullable(),
  createdAt: z.number(),
})

export type SpecRevision = z.infer<typeof specRevisionSchema>

export const specSectionSchema = z.object({
  id: z.string(),
  revisionId: z.string(),
  name: sectionNameSchema,
  body: z.string(),
  version: z.number(),
  author: specActorSchema,
  sessionId: z.string().nullable(),
  updatedAt: z.number(),
})

export type SpecSection = z.infer<typeof specSectionSchema>

export const userStorySchema = z.object({
  id: z.string(),
  revisionId: z.string(),
  title: z.string(),
  narrative: z.string(),
  priority: z.string().nullable(),
  rank: z.string(),
})

export type UserStory = z.infer<typeof userStorySchema>

export const acceptanceCriterionSchema = z.object({
  id: z.string(),
  storyId: z.string(),
  body: z.string(),
  rank: z.string(),
})

export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>

export const taskSetSchema = z.object({
  id: z.string(),
  revisionId: z.string(),
  kind: z.literal('contract'),
})

export type TaskSet = z.infer<typeof taskSetSchema>

export const specTaskSchema = z.object({
  id: z.string(),
  taskSetId: z.string(),
  title: z.string(),
  result: z.string(),
  type: z.string(),
  executor: taskExecutorSchema,
  criteria: z.string(),
  rank: z.string(),
})

export type SpecTask = z.infer<typeof specTaskSchema>

export const taskDependencySchema = z.object({ taskId: z.string(), dependsOnId: z.string() })

export type TaskDependency = z.infer<typeof taskDependencySchema>

export const taskStorySchema = z.object({ taskId: z.string(), storyId: z.string() })

export type TaskStory = z.infer<typeof taskStorySchema>

/** One answer offered with a question, the agent's recommendation marked (D7-01). */
export const specQuestionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  recommended: z.boolean().optional(),
})

export type SpecQuestionOption = z.infer<typeof specQuestionOptionSchema>

/** The human's answer: one of the options, or words of their own (D7-03). */
export const specAnswerSchema = z.object({
  optionId: z.string().nullable(),
  text: z.string().nullable(),
})

export type SpecAnswer = z.infer<typeof specAnswerSchema>

export const specQuestionSchema = z.object({
  id: z.string(),
  revisionId: z.string(),
  body: z.string(),
  blocking: z.boolean(),
  phase: phaseIdSchema.nullable(),
  raisedBy: specActorSchema,
  options: z.array(specQuestionOptionSchema),
  /** `null` while the question is open. */
  answer: specAnswerSchema.nullable(),
  resolvedAt: z.number().nullable(),
})

export type SpecQuestion = z.infer<typeof specQuestionSchema>

export const specPhaseSchema = z.object({
  id: z.string(),
  revisionId: z.string(),
  phase: phaseIdSchema,
  state: phaseStateSchema,
  summary: z.string().nullable(),
  assumptions: z.array(z.string()),
  /** The version of each section the phase was declared on (D7-08). */
  basis: z.partialRecord(sectionNameSchema, z.number()),
  protocolVersion: z.number(),
  declaredAt: z.number().nullable(),
})

export type SpecPhase = z.infer<typeof specPhaseSchema>

/** One revision of one Spec: what the panel draws and the ready gate reads. */
export const specSnapshotSchema = z.object({
  spec: specSchema,
  revision: specRevisionSchema,
  sections: z.array(specSectionSchema),
  stories: z.array(userStorySchema),
  criteria: z.array(acceptanceCriterionSchema),
  tasks: z.array(specTaskSchema),
  dependencies: z.array(taskDependencySchema),
  taskStories: z.array(taskStorySchema),
  questions: z.array(specQuestionSchema),
  phases: z.array(specPhaseSchema),
  /** When the writer's agent was last briefed: a later human edit is still to send (Decided 17). */
  briefedAt: z.number().nullable(),
})

export type SpecSnapshot = z.infer<typeof specSnapshotSchema>

/** A section edited in the panel and not saved yet, kept across a restart (D7-12). */
export const editBufferSchema = z.object({
  specId: z.string(),
  name: sectionNameSchema,
  body: z.string(),
  baseVersion: z.number(),
  updatedAt: z.number(),
})

export type EditBuffer = z.infer<typeof editBufferSchema>

/** A version a write is made against: counted from zero, never fractional. */
const versionSchema = z.number().int().nonnegative()

/**
 * The Spec use cases of the process that holds the database, spread into `ENGINE_REQUESTS`.
 *
 * Every write answers the snapshot it leaves, so the panel draws what was stored rather than
 * what it sent. The renderer only ever writes as the human actor (D7-04).
 */
export const SPEC_REQUESTS = {
  'specs.list': {
    arguments: z.object({ projectId: z.string() }),
    response: z.array(specSummarySchema),
  },
  'specs.read': {
    arguments: z.object({ specId: z.string(), revision: z.number().int().positive().optional() }),
    response: specSnapshotSchema,
  },
  'specs.revisions': {
    arguments: z.object({ specId: z.string() }),
    response: z.array(specRevisionSchema),
  },
  'specs.writeSection': {
    // Written against the version the editor was opened on: a stale one is refused (D7-12).
    arguments: z.object({
      specId: z.string(),
      sessionId: z.string(),
      name: sectionNameSchema,
      body: z.string(),
      baseVersion: versionSchema,
    }),
    response: specSnapshotSchema,
  },
  'specs.writeStories': {
    arguments: z.object({
      specId: z.string(),
      sessionId: z.string(),
      stories: z.array(
        z.object({
          id: z.string().optional(),
          title: z.string(),
          narrative: z.string(),
          priority: z.string().nullable(),
          criteria: z.array(z.string()),
        }),
      ),
    }),
    response: specSnapshotSchema,
  },
  'specs.writeTasks': {
    // `dependsOn` and `stories` name tasks and stories by title or by id (D7-06).
    arguments: z.object({
      specId: z.string(),
      sessionId: z.string(),
      tasks: z.array(
        z.object({
          id: z.string().optional(),
          title: z.string(),
          result: z.string(),
          type: z.string(),
          executor: taskExecutorSchema,
          criteria: z.string(),
          dependsOn: z.array(z.string()),
          stories: z.array(z.string()),
        }),
      ),
    }),
    response: specSnapshotSchema,
  },
  'specs.raiseQuestion': {
    // Asked in the chat of `sessionId` as well as kept in the Spec's register; no option is a
    // question answered in free text only (D7-01).
    arguments: z.object({
      specId: z.string(),
      sessionId: z.string(),
      body: z.string(),
      blocking: z.boolean(),
      phase: phaseIdSchema.nullable(),
      options: z.array(specQuestionOptionSchema),
    }),
    response: specSnapshotSchema,
  },
  'specs.answerQuestion': {
    // An option or a text, one of the two: neither and both are refused (D7-03).
    arguments: z.object({
      specId: z.string(),
      questionId: z.string(),
      optionId: z.string().optional(),
      text: z.string().optional(),
    }),
    response: specSnapshotSchema,
  },
  'specs.markReady': {
    // Made against the revision and content the gate was read on: anything newer refuses (D7-10).
    // `sessionId` is the Session whose panel the click came from, which its Journal line names
    // (D7-13).
    arguments: z.object({
      specId: z.string(),
      expectedRevisionId: z.string(),
      expectedContentVersion: versionSchema,
      sessionId: z.string(),
    }),
    response: specSnapshotSchema,
  },
  'specs.reopen': {
    // The reason is the human's to give or not; `sessionId` as for `specs.markReady`.
    arguments: z.object({
      specId: z.string(),
      expectedRevisionId: z.string(),
      reason: z.string().optional(),
      sessionId: z.string(),
    }),
    response: specSnapshotSchema,
  },
  'specs.transferWrite': {
    // The write right moves to this Session (D7-11).
    arguments: z.object({ specId: z.string(), sessionId: z.string() }),
    response: specSnapshotSchema,
  },
  'specs.buffers.read': {
    arguments: z.object({ specId: z.string() }),
    response: z.array(editBufferSchema),
  },
  'specs.buffers.save': {
    arguments: z.object({
      specId: z.string(),
      name: sectionNameSchema,
      body: z.string(),
      baseVersion: versionSchema,
    }),
    response: z.array(editBufferSchema),
  },
  'specs.buffers.discard': {
    arguments: z.object({ specId: z.string(), name: sectionNameSchema }),
    response: z.array(editBufferSchema),
  },
  /**
   * Gives the Spec a Workspace without asking for a build in it (D8-12): what "Prepare a Workspace
   * only" writes, and where the next launch proposes itself from. Answered as every Spec write is,
   * with the snapshot it leaves.
   */
  'specs.useWorkspace': {
    arguments: z.object({ specId: z.string(), workspaceId: z.string() }),
    response: specSnapshotSchema,
  },
} as const
