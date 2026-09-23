import { join } from 'node:path'
import { z } from 'zod'

import { type AgentAdapter, type Environment, versionIn } from '../adapter.ts'

/**
 * OpenCode, which speaks ACP itself (design D5-02, D5-21).
 *
 * There is no adapter package for this one: ACP is native in `opencode-ai`, so the command a
 * reader installs, the command that signs it in and the command Hemera starts as an agent are
 * the same one — `opencode`, with the `acp` subcommand, over standard input and output.
 * `--version` is answered by that same CLI (`docs/technical/acp-providers-2026-09.md` §4).
 *
 * Where it keeps its login is its own choice: `auth.json` in its data directory, which is
 * `$XDG_DATA_HOME/opencode` or `~/.local/share/opencode`, on every platform it runs on.
 *
 * OpenCode publishes a single method, "Login with opencode", which is `opencode auth login`
 * typed in a terminal, and its `authenticate` accepts no other one. Hemera does not type that
 * for the user, so the list is read as the sign-in itself: an agent that announced nothing has
 * nothing left to do, and an announced login is a Session that stops with a note rather than a
 * route taken on the user's behalf (D5-17).
 */

/**
 * The agent OpenCode is asked to be: one primary agent of Hemera's own, and nothing else.
 *
 * A catch-all deny is what removes a tool's definition from the request sent to the provider,
 * which is what bare mode means here — a per-tool deny would only refuse at call time, with the
 * definition still on its way. The `hemera_*` re-allow is mandatory rather than polite: MCP tools
 * go through the same filter, so a blanket deny hides Hemera's own tools too. `build` and `plan`
 * are the two primary agents OpenCode ships, and they are disabled so that the namespace is the
 * only one reachable.
 */
const BARE_AGENT = {
  default_agent: 'hemera',
  agent: {
    hemera: { mode: 'primary', permission: { '*': 'deny', 'hemera_*': 'allow' } },
    build: { disable: true },
    plan: { disable: true },
  },
}

/** The two settings of the user's own configuration that name a model, and nothing else of it. */
const MODELS = z.object({ model: z.string().optional(), small_model: z.string().optional() })

/** The models OpenCode's own interface was last used with, most recent first. */
const RECENT = z.object({
  recent: z.array(z.object({ providerID: z.string(), modelID: z.string() })),
})

/**
 * A JSONC text as JSON: its comments and its trailing commas gone, its strings untouched.
 *
 * OpenCode reads `opencode.jsonc` as well as `opencode.json`, and a comment in the user's file is
 * not a reason to lose the model it names.
 */
export function withoutComments(text: string): string {
  let out = ''
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      // A string is copied whole, escapes included: a `//` inside a URL is not a comment.
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

/** A text parsed by a schema, or `undefined` when it is not JSON or not that shape. */
function parsedAs<T>(schema: z.ZodType<T>, text: string | undefined): T | undefined {
  if (text === undefined) return undefined
  try {
    const parsed = schema.safeParse(JSON.parse(withoutComments(text)))
    return parsed.success ? parsed.data : undefined
  } catch {
    // A file the user left half-written is theirs to fix; the agent keeps nothing of it.
    return undefined
  }
}

/** Where OpenCode reads its global configuration: `$XDG_CONFIG_HOME/opencode`, on every platform. */
const configDirectory = (home: string, env: Environment) =>
  join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'opencode')

/** Where OpenCode keeps the models its interface was used with, which bare mode does not move. */
const stateFile = (home: string, env: Environment) =>
  join(env.XDG_STATE_HOME ?? join(home, '.local', 'state'), 'opencode', 'model.json')

/** The global configuration files, in the order OpenCode merges them: a later one wins. */
const configFiles = (home: string, env: Environment) =>
  ['config.json', 'opencode.json', 'opencode.jsonc'].map((name) =>
    join(configDirectory(home, env), name),
  )

export const opencode: AgentAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  command: 'opencode',
  installHint: 'npm install -g opencode-ai',
  loginHint: 'opencode auth login',
  loginFiles: (home, env) => [
    join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'opencode', 'auth.json'),
  ],
  package: 'opencode-ai',
  acp: { from: 'agent', command: 'opencode', args: ['acp'] },
  readVersion: versionIn,
  isAuthenticated: (methods) => methods.length === 0,
  /**
   * This agent's means is a configuration of its own, handed inline so that no file of the
   * user's is read to get it, plus the two variables that keep the project's own configuration
   * out of the way (D6-09).
   *
   * The platform is read because the wildcard matching is not the same on both: on Windows it is
   * case-insensitive, so the re-allow holds whatever case the agent spells the namespace in.
   * What survives the means is `$HOME/.opencode`, managed configuration and a remote
   * `.well-known/opencode`, which the Context view names.
   */
  bareMode: (platform) => ({
    means:
      platform === 'win32'
        ? "OPENCODE_CONFIG_CONTENT: a primary agent of Hemera's, a catch-all deny with the hemera_* namespace re-allowed, build and plan disabled — matched case-insensitively on Windows"
        : "OPENCODE_CONFIG_CONTENT: a primary agent of Hemera's, a catch-all deny with the hemera_* namespace re-allowed, build and plan disabled",
    base: 'embedded_resource',
    private:
      '$HOME/.opencode, its managed configuration and a remote .well-known/opencode still load; Hemera does not read them.',
    qualified: true,
    options: (input) => ({
      meta: undefined,
      env: {
        XDG_CONFIG_HOME: input.ownerDirectory,
        OPENCODE_DISABLE_PROJECT_CONFIG: '1',
        // The user's model first, Hemera's agent on top of it: the redirection above hides the
        // file that named it, and the agent's own default may be a model it refuses to serve
        // outside its interface. A model chosen in the composer is set after `session/new`, and
        // wins over this one.
        OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...input.own, ...BARE_AGENT }),
      },
      files: [],
    }),
  }),
  /**
   * The model the user works with, which `XDG_CONFIG_HOME` pointed at Hemera's directory would
   * lose (D6-09).
   *
   * `model` and `small_model` out of the user's own global configuration, and nothing else of
   * it: the file may hold a provider's key. Without a `model` there, the one the user last picked
   * in OpenCode's own interface — which the interface opens on, while `opencode acp` falls back
   * on the first free model of its own provider, a model it refuses to serve outside OpenCode.
   */
  own: {
    files: (home, env) => [...configFiles(home, env), stateFile(home, env)],
    kept: (texts) => {
      const kept: Record<string, string> = {}
      for (const text of texts.slice(0, -1)) {
        const models = parsedAs(MODELS, text)
        if (models?.model !== undefined) kept.model = models.model
        if (models?.small_model !== undefined) kept.small_model = models.small_model
      }
      if (kept.model === undefined) {
        const last = parsedAs(RECENT, texts.at(-1))?.recent[0]
        if (last !== undefined) kept.model = `${last.providerID}/${last.modelID}`
      }
      return kept
    },
  },
}
