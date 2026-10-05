/**
 * The identity of an action (CT-19), as Hemera computes it from the disk: the tool, the words of
 * the line (or the path a file tool acts on), the folder relative to the root of the place, the
 * repository, the catalogue id, the names of the variables the line sets, the real path of the
 * program, and the sha256 of the script when the program or its first argument is a file of the
 * place (`./scripts/seed.sh`, `node tools/gen.js`).
 *
 * An agent's call and Hemera's own run of the same catalogue command have the same identity, so
 * one "Allow for this mission" grant covers both.
 */

import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { type ActionIdentity, variablesSet, wordsOf } from '@hemera/core/domain'

import { findOnPath, hostLookup } from '../command-line.ts'
import { containedIn } from '../tools/paths.ts'
import { fingerprintFile } from '../tools/read.ts'
import type { JudgedCall } from '../tools/ports.ts'

/** A line to identify: what it runs, where, and as which catalogue command if it is one. */
export interface LineAsked {
  readonly tool: string
  /** The root of the place. */
  readonly root: string
  /** The folder it runs in, relative to the root, as asked (`.` for the root). */
  readonly folder: string
  readonly repository: string | null
  readonly catalogue: { readonly id: string; readonly line: string } | null
  readonly line: string
  readonly platform: NodeJS.Platform
}

/** The real path of a path, or the path itself when it does not resolve. */
const really = (path: string): Promise<string> => realpath(path).catch(() => path)

/** Whether a path is a file under the root, as the disk has them both. */
const fileOfPlace = async (root: string, path: string): Promise<boolean> => {
  const realRoot = await really(root)
  const real = await really(path)
  if (!containedIn(realRoot, real)) return false
  return stat(real).then(
    (found) => found.isFile(),
    () => false,
  )
}

/** The words a line hands its program: past `env`, its flags and the variables it sets. */
const programWords = (words: ReadonlyArray<string>): ReadonlyArray<string> => {
  let at = 0
  if (words[0] === 'env') {
    at = 1
    while (words[at]?.startsWith('-') === true) at += 1
  }
  return words.slice(at + variablesSet(words).length)
}

/** The identity of a command line. */
export async function lineIdentity(asked: LineAsked): Promise<ActionIdentity> {
  const words = wordsOf(asked.line)
  const [program, first] = programWords(words)
  const folder = resolve(asked.root, asked.folder)
  const named =
    program === undefined
      ? null
      : /[\\/]/.test(program) || isAbsolute(program)
        ? resolve(folder, program)
        : findOnPath(program, hostLookup(folder), asked.platform)
  const resolved = named === null ? null : await really(named)
  let script: string | null = null
  if (resolved !== null && (await fileOfPlace(asked.root, resolved))) {
    script = await fingerprintFile(resolved).catch(() => null)
  } else if (first !== undefined && (await fileOfPlace(asked.root, resolve(folder, first)))) {
    script = await fingerprintFile(resolve(folder, first)).catch(() => null)
  }
  const relativeFolder = relative(asked.root, folder).split(sep).join('/')
  return {
    tool: asked.tool,
    catalogue: asked.catalogue?.id ?? null,
    catalogueLine: asked.catalogue?.line ?? null,
    program: resolved,
    words,
    folder: relativeFolder === '' ? '.' : relativeFolder,
    repository: asked.repository,
    variables: variablesSet(words),
    script,
    target: null,
  }
}

/** The identity of a call the gate judged. */
export async function callIdentity(
  call: JudgedCall,
  platform: NodeJS.Platform,
): Promise<ActionIdentity> {
  if (call.tool === 'commands_run') {
    return lineIdentity({
      tool: call.tool,
      root: call.session.place.root,
      folder: call.command === null ? (call.folder ?? '.') : '.',
      repository: null,
      catalogue: call.command === null ? null : { id: call.command.id, line: call.command.line },
      line: call.command?.line ?? call.line ?? '',
      platform,
    })
  }
  return {
    tool: call.tool,
    catalogue: null,
    catalogueLine: null,
    program: null,
    words: [],
    folder: '.',
    repository: null,
    variables: [],
    script: null,
    target: call.path?.resolved ?? null,
  }
}
