import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

const repository = resolve(import.meta.dirname, '..')

/** The code of the apps and the packages, stories included, as Git tracks it. */
const sources = execFileSync('git', ['ls-files', 'apps/*/src/*', 'packages/*/src/*'], {
  cwd: repository,
  encoding: 'utf8',
})
  .split('\n')
  .filter((path) => /\.tsx?$/.test(path))

/** The lines of the sources that match `pattern`, as `path:line: text`. */
const linesMatching = (pattern: RegExp): string[] =>
  sources.flatMap((path) =>
    readFileSync(join(repository, path), 'utf8')
      .split('\n')
      .flatMap((line, at) => (pattern.test(line) ? [`${path}:${String(at + 1)}: ${line}`] : [])),
  )

/**
 * The French heading names a ticket's tolerant reading recognises (#95): words it reads in tickets
 * people write, not French written in the code.
 */
const isHeadingWord = (line: string): boolean =>
  /^packages\/core\/src\/domain\/tickets\.ts:\d+: +'pourquoi',$/.test(line)

describe('The public source', () => {
  test('says why the code is as it is without attributing a decision to a person', () => {
    expect(
      linesMatching(
        /\(the maintainer\b|\bmaintainer,? \d{1,2} [A-Z][a-z]+|as the maintainer (?:asked|said|wanted)/i,
      ),
    ).toEqual([])
  })

  test('is in English: no French quoted in a comment', () => {
    expect(
      linesMatching(
        /[«»]|(?<!\p{L})(?:c'est|ça|où|gère|faudrait|truc|vraiment|parce que|je|tu|nous|vous|pourquoi)(?!\p{L})/iu,
      ).filter((line) => !isHeadingWord(line)),
    ).toEqual([])
  })
})
