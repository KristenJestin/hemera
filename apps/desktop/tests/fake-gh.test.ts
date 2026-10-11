/**
 * The fake `gh` of the ticket suites answers calls made at once, as the engine makes them for
 * several providers: none of them reads the count of a rule while another writes it.
 */

import { execFile } from 'node:child_process'

import { afterEach, describe, expect, test } from 'vite-plus/test'

import { type FakeGh, fakeGh } from './fake-gh.ts'
import { removeFolders } from './storage.ts'

afterEach(removeFolders)

/** One call of the fake, as `gh` would be run: whether it ended well, and what it wrote. */
const call = (gh: FakeGh, args: ReadonlyArray<string>): Promise<{ ok: boolean; stdout: string }> =>
  new Promise((resolve, reject) => {
    const { program, env } = gh.settings
    if (program === undefined) return reject(new Error('the fake gh has no program'))
    const child = execFile(
      program.command,
      [...program.leading, ...args],
      { env },
      (error, stdout) => resolve({ ok: error === null, stdout }),
    )
    child.stdin?.end()
  })

describe('The fake gh answers calls made at once', () => {
  test('twenty calls at once each get their rule’s answer', async () => {
    const gh = fakeGh([{ when: ['search'], stdout: 'found' }])
    const answers = await Promise.all(
      Array.from({ length: 20 }, () => call(gh, ['search', 'issues'])),
    )
    expect(answers).toEqual(Array.from({ length: 20 }, () => ({ ok: true, stdout: 'found' })))
  })
})
