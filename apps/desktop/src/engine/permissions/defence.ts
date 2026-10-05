/**
 * The defence in depth of every command an agent of a mission runs, whatever the rules said of
 * it: a script of the Workspace that pushes or merges finds nothing to do it with.
 *
 * - The forge CLIs read their configuration from an empty folder, so none is signed in:
 *   `GH_CONFIG_DIR` (gh), `GLAB_CONFIG_DIR` (glab), `BKT_CONFIG_DIR` (bkt); and the variables
 *   that would sign them in without it are emptied (`GH_TOKEN`, `GITHUB_TOKEN`,
 *   `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GITLAB_TOKEN`, `GITLAB_ACCESS_TOKEN`,
 *   `OAUTH_TOKEN`, `BKT_TOKEN`).
 * - Git's push is neutralised by a configuration parameter in its environment
 *   (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`, after any the user set):
 *   `url.<invalid>.pushInsteadOf` with an empty prefix rewrites every push address to one that
 *   cannot exist, and leaves fetching alone.
 *
 * Hemera's own runs (delivery, checks, proofs) and the user's keep the real configuration.
 */

import { mkdirSync } from 'node:fs'

/** Where every push of an agent's command goes instead: a folder under a file, which never is. */
export const PUSH_REFUSED = '/dev/null/hemera-refused-push/'

/** The configuration folders of the forge CLIs, pointed at the empty folder. */
export const FORGE_CONFIG_VARIABLES = [
  'GH_CONFIG_DIR',
  'GLAB_CONFIG_DIR',
  'BKT_CONFIG_DIR',
] as const

/** The variables that sign a forge CLI in without its configuration, emptied. */
export const FORGE_TOKEN_VARIABLES = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GITLAB_TOKEN',
  'GITLAB_ACCESS_TOKEN',
  'OAUTH_TOKEN',
  'BKT_TOKEN',
] as const

/**
 * An agent's command's environment, defended. `emptyFolder` is created if it is not there; it
 * stays empty, since nothing signs in through it.
 */
export function defended(environment: Readonly<Record<string, string>>, emptyFolder: string) {
  mkdirSync(emptyFolder, { recursive: true })
  const count = Number.parseInt(environment['GIT_CONFIG_COUNT'] ?? '0', 10)
  const next = Number.isSafeInteger(count) && count > 0 ? count : 0
  const forges = Object.fromEntries(FORGE_CONFIG_VARIABLES.map((name) => [name, emptyFolder]))
  const tokens = Object.fromEntries(FORGE_TOKEN_VARIABLES.map((name) => [name, '']))
  return {
    ...environment,
    ...forges,
    ...tokens,
    GIT_CONFIG_COUNT: String(next + 1),
    [`GIT_CONFIG_KEY_${String(next)}`]: `url.${PUSH_REFUSED}.pushInsteadOf`,
    [`GIT_CONFIG_VALUE_${String(next)}`]: '',
  }
}
