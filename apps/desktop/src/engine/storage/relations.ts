/**
 * The relations of the schema, declared where the query builder reads them (design D3-04, D4-04).
 *
 * Lot 3 declared none and left the file in place so that this one would be an addition rather
 * than a new shape handed to a database already built. A project owns its working environments,
 * the locations it reads from and its Sessions, and a Session owns what was written in it; the
 * journal is deliberately not among them — an event is
 * correlated to a project, not owned by one, and nothing about it is ever loaded by walking
 * down from a project.
 */

import { defineRelations } from 'drizzle-orm'

import * as schema from './schema.ts'

export const relations = defineRelations(schema, (r) => ({
  projects: {
    workspaces: r.many.workspaces(),
    repositories: r.many.projectRepositories(),
    sessions: r.many.sessions(),
  },
  sessions: {
    project: r.one.projects({ from: r.sessions.projectId, to: r.projects.id }),
    entries: r.many.sessionEntries(),
  },
  sessionEntries: {
    session: r.one.sessions({ from: r.sessionEntries.sessionId, to: r.sessions.id }),
  },
  workspaces: {
    project: r.one.projects({ from: r.workspaces.projectId, to: r.projects.id }),
  },
  projectRepositories: {
    project: r.one.projects({ from: r.projectRepositories.projectId, to: r.projects.id }),
  },
}))
