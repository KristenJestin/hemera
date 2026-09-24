/**
 * The channels the renderer may call, and nothing else (design D0-04).
 *
 * A channel is a name, a schema for what it is called with, and a type for what it answers.
 * Both sides read this one declaration: the main process to validate what arrives, the
 * renderer to know what it may ask and what it gets back. A name that is not here does not
 * compile, so an untyped channel cannot be opened by accident.
 */

import { z } from 'zod'

import { environmentReportSchema } from './environment.ts'
import {
  ENGINE_REQUESTS,
  displayPreferencesChangeSchema,
  displayPreferencesSchema,
  nothingSchema,
  type EngineEvent,
} from './engine.ts'

/** What a location on disk turns out to hold, read at the moment it is asked about. */
export const repositoryStatusSchema = z.object({
  path: z.string(),
  /** The branch checked out there, or null when the location holds no repository. */
  git: z.string().nullable(),
  exists: z.boolean(),
})

/** What the window can be asked to do. Lot 2 wires these to the shell's own controls. */
export const windowCommandSchema = z.object({
  command: z.enum(['minimize', 'maximize', 'close']),
})

/**
 * Every channel of the application.
 *
 * `arguments` is what the caller sends and the main process validates; `response` is the
 * schema of what comes back, so the type of an answer is read from the same place.
 */
export const CHANNELS = {
  'env.report': {
    arguments: nothingSchema,
    response: environmentReportSchema,
  },
  'window.command': {
    arguments: windowCommandSchema,
    response: z.void(),
  },
  // What the page wears, asked for before it mounts anything and written back on every change.
  // The theme is a preference and not a colour: `system` is a choice too, and it is the one that
  // has to reach the main process — only the platform can lift an override, and only the main
  // process can tell the platform to.
  'preferences.read': {
    arguments: nothingSchema,
    response: displayPreferencesSchema,
  },
  'preferences.write': {
    arguments: displayPreferencesChangeSchema,
    response: z.void(),
  },

  // The Projects and their Journal, relayed to the process that holds the database. The very
  // schemas the engine declares, imported and not rewritten: two copies of a contract are two
  // contracts, and the day one of them gains a field the other is the bug.
  // What the settings say about the data folder, which only the engine can answer.
  'engine.status': ENGINE_REQUESTS['engine.status'],
  'projects.list': ENGINE_REQUESTS['projects.list'],
  'projects.create': ENGINE_REQUESTS['projects.create'],
  'projects.update': ENGINE_REQUESTS['projects.update'],
  'projects.moveMain': ENGINE_REQUESTS['projects.moveMain'],
  'projects.archive': ENGINE_REQUESTS['projects.archive'],
  'projects.restore': ENGINE_REQUESTS['projects.restore'],
  'repositories.add': ENGINE_REQUESTS['repositories.add'],
  'repositories.remove': ENGINE_REQUESTS['repositories.remove'],
  'projects.setWorkspacesRoot': ENGINE_REQUESTS['projects.setWorkspacesRoot'],
  'projects.setBranchPrefix': ENGINE_REQUESTS['projects.setBranchPrefix'],
  'projects.setRepositoryIncluded': ENGINE_REQUESTS['projects.setRepositoryIncluded'],
  'journal.read': ENGINE_REQUESTS['journal.read'],
  'journal.unseen': ENGINE_REQUESTS['journal.unseen'],
  'journal.markSeen': ENGINE_REQUESTS['journal.markSeen'],
  'sessions.list': ENGINE_REQUESTS['sessions.list'],
  'sessions.create': ENGINE_REQUESTS['sessions.create'],
  'sessions.rename': ENGINE_REQUESTS['sessions.rename'],
  'sessions.chooseWorkspace': ENGINE_REQUESTS['sessions.chooseWorkspace'],
  'sessions.archive': ENGINE_REQUESTS['sessions.archive'],
  'sessions.restore': ENGINE_REQUESTS['sessions.restore'],
  'sessions.append': ENGINE_REQUESTS['sessions.append'],
  'sessions.read': ENGINE_REQUESTS['sessions.read'],

  // The Specs, relayed the same way: the panel reads and writes them as the human (D7-04).
  'specs.list': ENGINE_REQUESTS['specs.list'],
  'specs.read': ENGINE_REQUESTS['specs.read'],
  'specs.revisions': ENGINE_REQUESTS['specs.revisions'],
  'specs.create': ENGINE_REQUESTS['specs.create'],
  'specs.openSession': ENGINE_REQUESTS['specs.openSession'],
  'specs.writeSection': ENGINE_REQUESTS['specs.writeSection'],
  'specs.writeStories': ENGINE_REQUESTS['specs.writeStories'],
  'specs.writeTasks': ENGINE_REQUESTS['specs.writeTasks'],
  'specs.raiseQuestion': ENGINE_REQUESTS['specs.raiseQuestion'],
  'specs.answerQuestion': ENGINE_REQUESTS['specs.answerQuestion'],
  'specs.markReady': ENGINE_REQUESTS['specs.markReady'],
  'specs.reopen': ENGINE_REQUESTS['specs.reopen'],
  'specs.transferWrite': ENGINE_REQUESTS['specs.transferWrite'],
  'specs.buffers.read': ENGINE_REQUESTS['specs.buffers.read'],
  'specs.buffers.save': ENGINE_REQUESTS['specs.buffers.save'],
  'specs.buffers.discard': ENGINE_REQUESTS['specs.buffers.discard'],

  // The agents, relayed the same way: what this machine has, what a Session's agent offers, and
  // what the window asks of a Session that is running — a turn, a stop, a decision, a resume.
  'agents.list': ENGINE_REQUESTS['agents.list'],
  'agents.options': ENGINE_REQUESTS['agents.options'],
  'agents.offer': ENGINE_REQUESTS['agents.offer'],
  'agents.offerSet': ENGINE_REQUESTS['agents.offerSet'],
  'agents.setOption': ENGINE_REQUESTS['agents.setOption'],
  'agents.prompt': ENGINE_REQUESTS['agents.prompt'],
  'agents.stop': ENGINE_REQUESTS['agents.stop'],
  'agents.decide': ENGINE_REQUESTS['agents.decide'],
  'agents.resume': ENGINE_REQUESTS['agents.resume'],
  // The two the Agents section is drawn from: what this machine has, and the one thing that
  // changes it, which happens because somebody pressed a button and not on its own (D5-18).
  'agents.check': ENGINE_REQUESTS['agents.check'],
  'agents.update': ENGINE_REQUESTS['agents.update'],

  // What Hemera lends the agent, relayed the same way: a Project's commands and the runs they
  // became, and what a Session was provided (design D6-10, D6-12).
  'commands.list': ENGINE_REQUESTS['commands.list'],
  'commands.portless': ENGINE_REQUESTS['commands.portless'],
  'commands.create': ENGINE_REQUESTS['commands.create'],
  'commands.update': ENGINE_REQUESTS['commands.update'],
  'commands.remove': ENGINE_REQUESTS['commands.remove'],
  'commands.runs': ENGINE_REQUESTS['commands.runs'],
  'commands.run': ENGINE_REQUESTS['commands.run'],
  'commands.stop': ENGINE_REQUESTS['commands.stop'],
  'commands.output': ENGINE_REQUESTS['commands.output'],
  'commands.runOf': ENGINE_REQUESTS['commands.runOf'],
  'commands.services': ENGINE_REQUESTS['commands.services'],
  'commands.stopService': ENGINE_REQUESTS['commands.stopService'],
  'commands.proposeAccept': ENGINE_REQUESTS['commands.proposeAccept'],
  'commands.proposeDecline': ENGINE_REQUESTS['commands.proposeDecline'],
  'context.read': ENGINE_REQUESTS['context.read'],

  // The Workspaces of a Project, their preparation, the Project's recipe and its variables,
  // relayed the same way: a worktree, a step and a variable are the engine's (D8-01 to D8-06).
  'workspaces.list': ENGINE_REQUESTS['workspaces.list'],
  'workspaces.plan': ENGINE_REQUESTS['workspaces.plan'],
  'workspaces.create': ENGINE_REQUESTS['workspaces.create'],
  'workspaces.createOnFolder': ENGINE_REQUESTS['workspaces.createOnFolder'],
  'workspaces.status': ENGINE_REQUESTS['workspaces.status'],
  'workspaces.cleanup': ENGINE_REQUESTS['workspaces.cleanup'],
  'preparation.steps': ENGINE_REQUESTS['preparation.steps'],
  'preparation.prepare': ENGINE_REQUESTS['preparation.prepare'],
  'preparation.resume': ENGINE_REQUESTS['preparation.resume'],
  'recipe.list': ENGINE_REQUESTS['recipe.list'],
  'recipe.add': ENGINE_REQUESTS['recipe.add'],
  'recipe.update': ENGINE_REQUESTS['recipe.update'],
  'recipe.remove': ENGINE_REQUESTS['recipe.remove'],
  'recipe.move': ENGINE_REQUESTS['recipe.move'],
  'variables.list': ENGINE_REQUESTS['variables.list'],
  'variables.set': ENGINE_REQUESTS['variables.set'],
  'variables.remove': ENGINE_REQUESTS['variables.remove'],

  /**
   * The four the main process answers itself, because each of them is something only it can do.
   *
   * A folder chosen by the system, a path opened by the desktop, what a location on disk holds
   * right now, and the files of a Workspace. None of them is a row, so none of them crosses to
   * the engine: asking a database where a Git branch is would be asking it to guess.
   */
  'dialog.pickFolder': {
    arguments: nothingSchema,
    response: z.string().nullable(),
  },
  /**
   * Files chosen by the system, answered relative to the root they were chosen under.
   *
   * The root is what the page is looking at and the main process is what enforces it: a file
   * picked outside the Workspace is dropped rather than attached, because an attachment is
   * something the Project is about and a path out of its tree is not.
   */
  'dialog.pickFiles': {
    arguments: z.object({ root: z.string() }),
    response: z.array(z.string()),
  },
  /**
   * Opens one of the two things the settings offer, with the desktop.
   *
   * A choice and never a path: the page has no business knowing where the data folder is or
   * what the diagnostic is called, and a channel that took a path would be a channel a page
   * could be talked into opening anything with. What each of the two resolves to is the main
   * process's, which is the one that was started on the folder.
   */
  'shell.open': {
    arguments: z.object({ what: z.enum(['folder', 'diagnostic']) }),
    response: z.void(),
  },
  'repositories.status': {
    arguments: z.object({ root: z.string(), paths: z.array(z.string()) }),
    response: z.array(repositoryStatusSchema),
  },
  /**
   * What sits directly under a Workspace, so the settings can offer it instead of asking for it.
   *
   * One level: what a Workspace holds at its top is what the Project is made of, and a `src`
   * two levels down is not a location anybody declares.
   */
  'workspace.folders': {
    arguments: z.object({ root: z.string() }),
    response: z.array(repositoryStatusSchema),
  },
  /**
   * Whether a folder can hold a Workspace, and what is wrong with it when it cannot.
   *
   * A sentence and not a boolean: a folder that is not there, one that is a file, and one that
   * cannot be read are three refusals, and the specification asks for the cause to be named.
   */
  'workspace.check': {
    arguments: z.object({ path: z.string() }),
    response: z.object({ ok: z.boolean(), reason: z.string().nullable() }),
  },
  'workspace.files': {
    arguments: z.object({
      root: z.string(),
      query: z.string(),
      limit: z.number().int().positive().max(100).optional(),
    }),
    response: z.array(z.string()),
  },
} as const

export type Channels = typeof CHANNELS

export type ChannelName = keyof Channels

export type ChannelArguments<K extends ChannelName> = z.infer<Channels[K]['arguments']>

export type ChannelResponse<K extends ChannelName> = z.infer<Channels[K]['response']>

/** The shape the preload exposes to the renderer, derived from the declaration above. */
export interface Bridge {
  invoke<K extends ChannelName>(
    channel: K,
    argument: ChannelArguments<K>,
  ): Promise<ChannelResponse<K>>
  /**
   * What the engine pushes on its own, as it happens.
   *
   * One subscription for all of it, and what it answers is the way to stop listening: the page
   * keeps the Session it has open and hears about that one, so a page that could not stop
   * listening would keep hearing about every Session it ever opened.
   */
  on(listener: (event: EngineEvent) => void): () => void
}
