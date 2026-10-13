/**
 * Which forge a repository uses (#253), from its remote's URL, pure.
 *
 * A remote URL is read in its HTTPS and SSH forms (`git@host:owner/repo.git`,
 * `ssh://git@host:7999/project/repo.git`, `https://host/scm/project/repo.git`): the host, then the
 * owner (a GitHub owner, a Bitbucket Cloud workspace, a Data Center project key) and the slug. Host
 * `github.com` is GitHub, `bitbucket.org` is Bitbucket Cloud, any other is unknown: Bitbucket Data
 * Center and GitHub Enterprise Server have no fixed host, so they are forced per repository, and a
 * forced forge wins over detection.
 */

import type { ForcedForge, ForgeName } from '@hemera/ipc'

/** Where a remote says a repository is. */
export interface RemoteIdentity {
  readonly host: string
  readonly owner: string
  readonly slug: string
}

/** A forge forced on a repository, with its host where it has no fixed one. */
export interface ForcedSetting {
  readonly forge: ForcedForge
  readonly host: string | null
}

/** The identity of a repository on its forge. */
export interface ForgeIdentity {
  readonly forge: ForgeName
  readonly host: string | null
  readonly owner: string | null
  readonly slug: string | null
  readonly forced: boolean
}

/** The hosts of the forges that have one. */
export const GITHUB_HOST = 'github.com'
export const BITBUCKET_CLOUD_HOST = 'bitbucket.org'

/** `git@host:path`, the SCP-like form of SSH. */
const SCP_LIKE = /^[^@/\s]+@([^:/\s]+):(.+)$/

/** The host and the path of a remote URL, or null when it is not one (a local path). */
const located = (url: string): { host: string; path: string } | null => {
  const scp = SCP_LIKE.exec(url)
  if (scp !== null && !url.includes('://')) return { host: scp[1] ?? '', path: scp[2] ?? '' }
  if (!/^(https?|ssh|git):\/\//i.test(url)) return null
  try {
    const parsed = new URL(url)
    return { host: parsed.hostname, path: decodeURIComponent(parsed.pathname) }
  } catch {
    return null
  }
}

/** The host, owner and slug a remote URL names, or null. */
export const parseRemote = (url: string): RemoteIdentity | null => {
  const found = located(url.trim())
  if (found === null || found.host === '') return null
  const segments = found.path.split('/').filter((one) => one !== '')
  // Data Center's HTTPS form puts its repositories under `scm/`, after an optional context path.
  const scm = segments.lastIndexOf('scm')
  const kept = scm >= 0 && segments.length - scm === 3 ? segments.slice(scm + 1) : segments
  if (kept.length < 2) return null
  const owner = kept[kept.length - 2] ?? ''
  const slug = (kept[kept.length - 1] ?? '').replace(/\.git$/i, '')
  if (owner === '' || slug === '') return null
  return { host: found.host.toLowerCase(), owner, slug }
}

const detected = (host: string): ForgeName =>
  host === GITHUB_HOST ? 'github' : host === BITBUCKET_CLOUD_HOST ? 'bitbucket-cloud' : 'unknown'

/** The host a forced forge reaches: its fixed one, or the one forced with it. */
const forcedHost = (forced: ForcedSetting, remoteHost: string | null): string | null => {
  if (forced.forge === 'none') return null
  if (forced.forge === 'bitbucket-cloud') return BITBUCKET_CLOUD_HOST
  if (forced.forge === 'github') return forced.host ?? GITHUB_HOST
  return forced.host ?? remoteHost
}

/** The identity of a repository on its forge: forced when it is, detected from its remote otherwise. */
export const identify = (url: string | null, forced: ForcedSetting | null): ForgeIdentity => {
  const remote = url === null ? null : parseRemote(url)
  const where = { owner: remote?.owner ?? null, slug: remote?.slug ?? null }
  if (forced !== null) {
    return {
      forge: forced.forge,
      host: forcedHost(forced, remote?.host ?? null),
      ...where,
      forced: true,
    }
  }
  if (remote === null) return { forge: 'unknown', host: null, ...where, forced: false }
  return { forge: detected(remote.host), host: remote.host, ...where, forced: false }
}
