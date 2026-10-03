#!/usr/bin/env node
/**
 * The AUR packages of Hemera, moved to a release once it is published (packaging/aur/).
 *
 * `hemera-bin` follows the `vX.Y.Z` tags semantic-release puts on `main`, `hemera-beta-bin` the
 * `vX.Y.Z-beta.N` pre-releases it puts on `dev`. Both install as `hemera` and conflict with each
 * other, so installing one replaces the other. Both are the PKGBUILD in this repository with its
 * version, its pkgrel and its checksum changed, and the .SRCINFO changed the same way: nothing
 * here needs makepkg, so it runs the same on a runner and on any machine with Node and git.
 *
 *   node tools/aur-publish.ts <package> <tag>                  update packaging/aur/<package>
 *   node tools/aur-publish.ts <package> <tag> --out <folder>   write the two files there
 *   node tools/aur-publish.ts <package> <tag> --push           commit them to the AUR
 *
 * `--push` reads the SSH key from `AUR_SSH_KEY`. Without it, nothing is published and the
 * command says so and succeeds: a fork, or a repository whose AUR packages do not exist yet,
 * does not fail its release for it.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const AUR_PACKAGES = ['hemera-bin', 'hemera-beta-bin'] as const
export type AurPackage = (typeof AUR_PACKAGES)[number]

/** The AUR's own host key, as it publishes it on aur.archlinux.org: no first-use trust. */
const AUR_HOST_KEY =
  'aur.archlinux.org ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEuBKrPzbawxA/k2g6NcyV5jmqwJ2s+zpgZGZ7tpLIcN'

/** Who the AUR commits are made by. */
const AUTHOR = { name: 'kris', email: 'kristen.jestin@pm.me' }

export interface AurVersion {
  /** The version as the release names it: its tag without the prefix. */
  version: string
  /** The same as pacman orders it, with no dash. */
  pkgver: string
}

/**
 * The version a tag gives a package. A beta is `vX.Y.Z-beta.N`, which pacman cannot take with
 * its dash: `X.Y.ZbetaN` keeps the order, since pacman puts a version with letters after its
 * numbers before the same numbers alone, so `0.5.0beta1` < `0.5.0beta2` < `0.5.0`.
 */
export function versionOf(name: AurPackage, tag: string): AurVersion {
  if (name === 'hemera-bin') {
    const release = /^v(\d+\.\d+\.\d+)$/.exec(tag)
    if (release?.[1] === undefined) throw new Error(`${tag} is not a release tag (vX.Y.Z)`)
    return { version: release[1], pkgver: release[1] }
  }
  const beta = /^v((\d+\.\d+\.\d+)-beta\.(\d+))$/.exec(tag)
  if (beta?.[1] === undefined || beta[2] === undefined || beta[3] === undefined) {
    throw new Error(`${tag} is not a beta tag (vX.Y.Z-beta.N)`)
  }
  return { version: beta[1], pkgver: `${beta[2]}beta${beta[3]}` }
}

/** The PKGBUILD of that version: pkgrel back to 1, and the checksum of what it downloads. */
export function renderPkgbuild(pkgbuild: string, version: AurVersion, sha256: string): string {
  return pkgbuild
    .replace(/^_version=.*$/m, `_version=${version.version}`)
    .replace(/^pkgver=.*$/m, `pkgver=${version.pkgver}`)
    .replace(/^pkgrel=.*$/m, 'pkgrel=1')
    .replace(/^sha256sums=\(.*\)$/m, `sha256sums=('${sha256}')`)
}

/** The value of a shell word as a PKGBUILD writes it: quoted once, `$name` expanded. */
function wordValue(word: string, variables: Map<string, string>): string {
  if (word.startsWith("'") && word.endsWith("'")) return word.slice(1, -1)
  const unquoted = word.startsWith('"') && word.endsWith('"') ? word.slice(1, -1) : word
  return unquoted.replaceAll(/\$\{?(\w+)\}?/g, (_, variable: string) => {
    const value = variables.get(variable)
    if (value === undefined) throw new Error(`$${variable} is not assigned before it is used`)
    return value
  })
}

/** Every `name=value` assignment of a single word, in order, each expanded with the ones above. */
function assignmentsOf(pkgbuild: string): Map<string, string> {
  const variables = new Map<string, string>()
  for (const [, variable, word] of pkgbuild.matchAll(/^(\w+)=([^(\n].*)$/gm)) {
    if (variable !== undefined && word !== undefined) {
      variables.set(variable, wordValue(word, variables))
    }
  }
  return variables
}

/** The value of a single-word assignment, expanded. */
export function scalarOf(pkgbuild: string, variable: string): string {
  const value = assignmentsOf(pkgbuild).get(variable)
  if (value === undefined) throw new Error(`the PKGBUILD assigns no ${variable}`)
  return value
}

/** The words of a one-line array assignment, `name=(…)`, each expanded as makepkg would. */
export function arrayOf(pkgbuild: string, variable: string): string[] {
  const words = new RegExp(`^${variable}=\\((.*)\\)$`, 'm').exec(pkgbuild)?.[1]
  if (words === undefined) throw new Error(`the PKGBUILD has no one-line ${variable}`)
  const variables = assignmentsOf(pkgbuild)
  return (words.match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map((word) => wordValue(word, variables))
}

/** The one source of the PKGBUILD, as makepkg expands it: `<file>::<url>`. */
export function expandedSource(pkgbuild: string): string {
  const [source, ...more] = arrayOf(pkgbuild, 'source')
  if (source === undefined || more.length > 0) throw new Error('the PKGBUILD has no one source')
  return source
}

function sha256sumOf(pkgbuild: string): string {
  const sum = /^sha256sums=\('([0-9a-f]{64}|SKIP)'\)$/m.exec(pkgbuild)?.[1]
  if (sum === undefined) throw new Error('the PKGBUILD has no one sha256sum')
  return sum
}

/**
 * The .SRCINFO of a PKGBUILD, from the one makepkg wrote for its previous version: only what a
 * new version changes is written again. The verification of `packaging/aur/` compares the
 * result with `makepkg --printsrcinfo`, so a PKGBUILD that changes anything else is caught there.
 */
export function renderSrcinfo(srcinfo: string, pkgbuild: string): string {
  return srcinfo
    .replace(/^\tpkgver = .*$/m, `\tpkgver = ${scalarOf(pkgbuild, 'pkgver')}`)
    .replace(/^\tpkgrel = .*$/m, `\tpkgrel = ${scalarOf(pkgbuild, 'pkgrel')}`)
    .replace(/^\tsource = .*$/m, `\tsource = ${expandedSource(pkgbuild)}`)
    .replace(/^\tsha256sums = .*$/m, `\tsha256sums = ${sha256sumOf(pkgbuild)}`)
}

/** Why a publication does not happen here, or null when it can. */
export function skippedWithout(
  environment: Record<string, string | undefined>,
  name: AurPackage,
): string | null {
  if ((environment.AUR_SSH_KEY ?? '') !== '') return null
  return `AUR_SSH_KEY is not set: ${name} is not published to the AUR`
}

async function sha256Of(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok || response.body === null) {
    throw new Error(`${url} answered ${String(response.status)}`)
  }
  const hash = createHash('sha256')
  for await (const chunk of response.body) hash.update(chunk)
  return hash.digest('hex')
}

function git(args: string[], cwd: string, environment: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: environment })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout
}

/** Commits the two files to the package's AUR repository and pushes them, when they changed. */
function push(name: AurPackage, files: Map<string, string>, pkgver: string, key: string): void {
  const scratch = mkdtempSync(join(tmpdir(), 'aur-'))
  try {
    const identity = join(scratch, 'key')
    const knownHosts = join(scratch, 'known_hosts')
    // A key pasted into a secret often loses its last newline, and ssh refuses it without one.
    writeFileSync(identity, key.endsWith('\n') ? key : `${key}\n`, { mode: 0o600 })
    writeFileSync(knownHosts, `${AUR_HOST_KEY}\n`)
    const environment = {
      ...process.env,
      GIT_SSH_COMMAND: `ssh -i '${identity}' -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile='${knownHosts}'`,
    }

    const clone = join(scratch, name)
    git(['clone', `ssh://aur@aur.archlinux.org/${name}.git`, clone], scratch, environment)
    for (const [file, content] of files) writeFileSync(join(clone, file), content)
    if (git(['status', '--porcelain'], clone) === '') {
      console.log(`${name} is already at ${pkgver} on the AUR`)
      return
    }
    git(['add', ...files.keys()], clone)
    git(
      [
        '-c',
        `user.name=${AUTHOR.name}`,
        '-c',
        `user.email=${AUTHOR.email}`,
        'commit',
        '-m',
        `Update to ${pkgver}-1`,
      ],
      clone,
    )
    // The AUR only accepts `master`, whatever a fresh clone of an empty repository calls its branch.
    git(['push', 'origin', 'HEAD:master'], clone, environment)
    console.log(`${name} ${pkgver}-1 is published to the AUR`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function optionOf(args: string[], option: string): string | undefined {
  const at = args.indexOf(option)
  return at === -1 ? undefined : args[at + 1]
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const [asked, tag] = args
  const name = AUR_PACKAGES.find((known) => known === asked)
  if (name === undefined || tag === undefined) {
    console.error(
      `usage: node tools/aur-publish.ts <${AUR_PACKAGES.join('|')}> <tag> [--out <folder>] [--push]`,
    )
    process.exit(1)
  }

  const publishing = args.includes('--push')
  const skipped = publishing ? skippedWithout(process.env, name) : null
  if (skipped !== null) {
    console.log(process.env.GITHUB_ACTIONS === 'true' ? `::notice::${skipped}` : skipped)
    process.exit(0)
  }

  const template = resolve(import.meta.dirname, '..', 'packaging', 'aur', name)
  const version = versionOf(name, tag)
  const unsummed = renderPkgbuild(
    readFileSync(join(template, 'PKGBUILD'), 'utf8'),
    version,
    '0'.repeat(64),
  )
  const url = expandedSource(unsummed).split('::').at(-1) ?? ''
  const pkgbuild = renderPkgbuild(unsummed, version, await sha256Of(url))
  const srcinfo = renderSrcinfo(readFileSync(join(template, '.SRCINFO'), 'utf8'), pkgbuild)
  const files = new Map([
    ['PKGBUILD', pkgbuild],
    ['.SRCINFO', srcinfo],
  ])

  if (publishing) {
    push(name, files, version.pkgver, process.env.AUR_SSH_KEY ?? '')
  } else {
    const out = resolve(optionOf(args, '--out') ?? template)
    mkdirSync(out, { recursive: true })
    for (const [file, content] of files) writeFileSync(join(out, file), content)
    console.log(`${name} ${version.pkgver}-1 written to ${out}`)
  }
}
