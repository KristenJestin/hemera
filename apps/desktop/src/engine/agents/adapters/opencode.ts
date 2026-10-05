/**
 * OpenCode, which speaks ACP itself: the command the user installs, signs in with and Hemera
 * starts is the same one, `opencode`, with `acp`.
 *
 * The login is `auth.json` in its data folder, `$XDG_DATA_HOME/opencode` or
 * `~/.local/share/opencode`, on every OS. It announces a single method, `opencode auth login`
 * typed in a terminal: an announced login is a sign-in still to do.
 *
 * Bare mode is a configuration of Hemera's, handed inline: a primary agent `hemera` whose
 * permissions deny everything but Hemera's tools, `build` and `plan` disabled (so it offers no
 * mode), its configuration folder moved to Hemera's and the project's own configuration off. The
 * move hides the user's own file, and with it the model they work with: that model (and their
 * small model) is read from their files and merged in, and nothing else of them.
 */

import { join } from 'node:path'

import { NotQualified, Qualified } from '@hemera/ipc'
import { Option, Schema } from 'effect'

import type { AgentAdapter, Environment } from '../adapter.ts'
import { hemeraServer } from '../bare.ts'

/**
 * Why OpenCode is not qualified on Linux: nothing in its means depends on the OS, but it has not
 * run bare there yet. Qualified means "ran bare here"; the declaration changes on that proof only.
 */
export const NOT_RUN_ON_LINUX =
  'it has not run bare on Linux yet, and Hemera only runs an agent bare where that was shown'

/**
 * A catch-all deny is what removes a tool's definition from what the model is sent; the
 * `hemera_*` re-allow is mandatory, since MCP tools go through the same filter.
 */
const BARE_AGENT = {
  default_agent: 'hemera',
  agent: {
    hemera: { mode: 'primary', permission: { '*': 'deny', 'hemera_*': 'allow' } },
    build: { disable: true },
    plan: { disable: true },
  },
}

/** The two settings of the user's configuration that name a model, and nothing else of it. */
const Models = Schema.fromJsonString(
  Schema.Struct({
    model: Schema.optionalKey(Schema.String),
    small_model: Schema.optionalKey(Schema.String),
  }),
)

/** The models OpenCode's own interface was last used with, most recent first. */
const Recent = Schema.fromJsonString(
  Schema.Struct({
    recent: Schema.Array(Schema.Struct({ providerID: Schema.String, modelID: Schema.String })),
  }),
)

const readModels = Schema.decodeUnknownOption(Models)
const readRecent = Schema.decodeUnknownOption(Recent)

/**
 * A JSONC text as JSON: comments and trailing commas gone, strings untouched (a `//` inside a URL
 * is not a comment). OpenCode reads `opencode.jsonc` as well as `opencode.json`.
 */
export function withoutComments(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      let end = index + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      out += text.slice(index, end + 1)
      index = end + 1
    } else if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index)
      index = end === -1 ? text.length : end
    } else if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2)
      index = end === -1 ? text.length : end + 2
    } else {
      out += char
      index += 1
    }
  }
  return out.replaceAll(/,(\s*[}\]])/g, '$1')
}

const configFolder = (home: string, env: Environment) =>
  join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'opencode')

export const opencode: AgentAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  command: 'opencode',
  package: 'opencode-ai',
  installHint: 'npm install -g opencode-ai',
  loginHint: 'opencode auth login',
  loginFiles: (home, env) => [
    join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'opencode', 'auth.json'),
  ],
  acp: { from: 'agent', args: ['acp'] },
  isAuthenticated: (methods) => methods.length === 0,
  qualification: (platform) =>
    platform === 'linux' ? NotQualified.make({ reason: NOT_RUN_ON_LINUX }) : Qualified.make({}),
  bareOptions: (input) => ({
    mcpServers: [hemeraServer(input.hemera)],
    meta: undefined,
    env: {
      XDG_CONFIG_HOME: input.agentDirectory,
      OPENCODE_DISABLE_PROJECT_CONFIG: '1',
      // The user's model first, Hemera's agent on top of it.
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...input.own, ...BARE_AGENT }),
    },
    systemPromptAs: 'embedded-resource',
  }),
  ownSettings: {
    // The global configuration files in the order OpenCode merges them (a later one wins), then
    // the state file of its interface, which bare mode does not move.
    files: (home, env) => [
      ...['config.json', 'opencode.json', 'opencode.jsonc'].map((name) =>
        join(configFolder(home, env), name),
      ),
      join(env.XDG_STATE_HOME ?? join(home, '.local', 'state'), 'opencode', 'model.json'),
    ],
    kept: (texts) => {
      const parsed = texts
        .slice(0, -1)
        .flatMap((text) =>
          text === undefined ? [] : Option.toArray(readModels(withoutComments(text))),
        )
      const model = parsed.findLast((one) => one.model !== undefined)?.model
      const small = parsed.findLast((one) => one.small_model !== undefined)?.small_model
      const last = texts.at(-1)
      const recent =
        last === undefined ? undefined : Option.getOrUndefined(readRecent(last))?.recent[0]
      const fallback = recent === undefined ? undefined : `${recent.providerID}/${recent.modelID}`
      const kept: ReadonlyArray<readonly [string, string | undefined]> = [
        ['model', model ?? fallback],
        ['small_model', small],
      ]
      return Object.fromEntries(kept.filter(([, value]) => value !== undefined))
    },
  },
}
