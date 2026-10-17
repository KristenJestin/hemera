/**
 * The guard on the engine's own Git (#457): whatever an agent changes of what shapes Git in its
 * place (a configuration, a hook, an attribute, an include, the home's configuration), however it
 * was made, the engine runs none of its own Git calls on that repository until the user has seen
 * the change and allowed it. Through the real gate of a real engine, with a judge that allows
 * everything, so #448's line checks are not what stops these routes: each change is made by a
 * script or a program the line does not show.
 *
 * Every repository is made for the test under the temporary directory; the home the engine reads
 * is a temporary folder too, never the user's.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PermissionAnswer } from '@hemera/core/domain'
import type { Need } from '@hemera/ipc'
import { Effect, Fiber, Layer, Predicate } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { Git } from '../src/engine/git.ts'
import { answerNeed, listNeeds } from '../src/engine/needs.ts'
import { Judge } from '../src/engine/permissions/ports.ts'
import type { EngineServices } from '../src/engine/profile.ts'
import { commandsEngine, until } from './commands-engine.ts'
import { git, remote, repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeWithMission, callTool, questionsKept, sessionOf } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('git-guard'))
  work = realpathSync.native(temporaryFolder('git-guard-work'))
})
afterEach(removeFolders)

const ALLOWS = Layer.succeed(Judge, {
  judge: () => Effect.succeed({ verdict: 'allow', reason: 'risk 0.1' }),
})

/** The questions the guard raised: the pending permission needs (calls ask through a stand-in). */
const guardNeeds = Effect.map(listNeeds, (groups) =>
  groups
    .flatMap((group) => group.needs)
    .flatMap((need) => (Predicate.isTagged(need.fields, 'Permission') ? [need] : [])),
)

/** What a need shows: its changed files and their diff. */
const shown = (need: Need | undefined): string =>
  need !== undefined && Predicate.isTagged(need.fields, 'Permission') ? need.fields.call : ''

/** Waits for the guard's question, a few seconds at most. */
const asked = until(guardNeeds, (needs) => needs.length > 0)

/** The engine's own `git status` of a folder: its answer, or why it was refused. */
const engineStatus = (folder: string) =>
  Git.use((service) => service.status(folder)).pipe(
    Effect.map(() => 'ran'),
    Effect.catchTag('GitFailed', (refused) => Effect.succeed(String(refused.stderr))),
  )

const allow = (need: Need) =>
  answerNeed({
    id: need.id,
    answer: PermissionAnswer.make({ choice: 'allow-once' }),
    key: crypto.randomUUID(),
  })

const deny = (need: Need) =>
  answerNeed({
    id: need.id,
    answer: PermissionAnswer.make({ choice: 'deny' }),
    key: crypto.randomUUID(),
  })

let scripts = 0

/**
 * A script the agent's command runs, kept in its checkout (a path outside it would ask): Node, so
 * the line says nothing of what it writes. What it needs is written into it, never on the line.
 */
const runScript = (builder: string, main: string, body: string) =>
  Effect.gen(function* () {
    scripts += 1
    const name = `step-${String(scripts)}.mjs`
    mkdirSync(join(main, 'scripts'), { recursive: true })
    writeFileSync(join(main, 'scripts', name), body)
    return yield* callTool(builder, 'commands_run', {
      line: `"${process.execPath}" scripts/${name}`,
    })
  })

/**
 * One engine whose home is the work folder and whose judge allows everything: runs `body` with a
 * Builder of Acme's mission in Acme's main checkout, a repository with one commit.
 */
const withBuilder = <A, E>(
  body: (world: {
    readonly builder: string
    readonly main: string
  }) => Effect.Effect<A, E, EngineServices>,
) => {
  const questions = questionsKept()
  return commandsEngine(data, {
    tools: { home: work, judge: ALLOWS, permissionRequests: questions.layer },
  })((started) =>
    started.profile.use(
      Effect.gen(function* () {
        const { mission, main } = yield* acmeWithMission(work)
        repository(main)
        const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
        return yield* body({ builder: builder.grantId, main })
      }),
    ),
  )
}

describe('A change to what shapes Git stops the engine’s Git until the user allows it (#457)', () => {
  test('1. a shell script the agent writes, then runs, that sets core.hooksPath', async () => {
    const windows = process.platform === 'win32'
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        const file = windows ? 'configure.cmd' : 'configure.sh'
        const wrote = yield* callTool(builder, 'fs_write', {
          path: file,
          content: windows ? '@git config core.hooksPath h\r\n' : 'git config core.hooksPath h\n',
        })
        const ran = yield* callTool(builder, 'commands_run', {
          line: windows ? `cmd /c ${file}` : `sh ${file}`,
        })
        const needs = yield* asked
        return { wrote, ran, needs, status: yield* engineStatus(main), main }
      }),
    )
    expect(result.wrote.ok).toBe(true)
    expect(result.ran.ok).toBe(true)
    expect(result.needs).toHaveLength(1)
    expect(shown(result.needs[0])).toContain('~/acme/.git/config')
    expect(shown(result.needs[0])).toContain('+ \thooksPath = h')
    expect(result.status).toContain('Hemera stopped its Git')
    // Nothing is restored on its own.
    expect(readFileSync(join(result.main, '.git', 'config'), 'utf8')).toContain('hooksPath = h')
  })

  test('2. a Node program that writes .git/config', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        yield* runScript(
          builder,
          main,
          `import { appendFileSync } from 'node:fs'
appendFileSync(['.g', 'it/con', 'fig'].join(''), '[filter "x"]\\n\\tclean = ./clean.sh\\n')
`,
        )
        return { needs: yield* asked, status: yield* engineStatus(main) }
      }),
    )
    expect(result.needs).toHaveLength(1)
    expect(shown(result.needs[0])).toContain('+ \tclean = ./clean.sh')
    expect(result.status).toContain('Hemera stopped its Git')
  })

  test('3. a template copied by git init through GIT_CONFIG_*', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        const template = join(main, 'template')
        mkdirSync(join(template, 'hooks'), { recursive: true })
        writeFileSync(join(template, 'hooks', 'post-checkout'), '#!/bin/sh\necho hello\n')
        yield* runScript(
          builder,
          main,
          `import { spawnSync } from 'node:child_process'
spawnSync('git', ['init', '-q'], {
  env: {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'init.templateDir',
    GIT_CONFIG_VALUE_0: ${JSON.stringify(template)},
  },
})
`,
        )
        return {
          needs: yield* asked,
          status: yield* engineStatus(main),
          copied: existsSync(join(main, '.git', 'hooks', 'post-checkout')),
        }
      }),
    )
    expect(result.copied).toBe(true)
    expect(result.needs).toHaveLength(1)
    expect(shown(result.needs[0])).toContain('~/acme/.git/hooks/post-checkout')
    expect(result.status).toContain('Hemera stopped its Git')
  })

  test('4. a hook added under .git/hooks', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        yield* runScript(
          builder,
          main,
          `import { writeFileSync } from 'node:fs'
writeFileSync(['.git', 'hooks', 'pre-commit'].join('/'), '#!/bin/sh\\necho gotcha\\n')
`,
        )
        return { needs: yield* asked, status: yield* engineStatus(main) }
      }),
    )
    expect(result.needs).toHaveLength(1)
    expect(shown(result.needs[0])).toContain('~/acme/.git/hooks/pre-commit')
    expect(shown(result.needs[0])).toContain('+ echo gotcha')
    expect(result.status).toContain('Hemera stopped its Git')
  })

  test('5. a change in an included file outside .git, written by a file tool', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        git(main, 'config', 'include.path', '../shared.gitconfig')
        writeFileSync(join(main, 'shared.gitconfig'), '[user]\n\tname = t\n')
        yield* callTool(builder, 'fs_read', { path: 'shared.gitconfig' })
        const wrote = yield* callTool(builder, 'fs_write', {
          path: 'shared.gitconfig',
          content: '[user]\n\tname = t\n[core]\n\tfsmonitor = ./watch.sh\n',
        })
        return { wrote, needs: yield* asked, status: yield* engineStatus(main) }
      }),
    )
    expect(result.wrote.ok).toBe(true)
    expect(result.needs).toHaveLength(1)
    expect(shown(result.needs[0])).toContain('~/acme/shared.gitconfig')
    expect(shown(result.needs[0])).toContain('+ \tfsmonitor = ./watch.sh')
    expect(result.status).toContain('Hemera stopped its Git')
  })

  test('6. a change to ~/.gitconfig stops the engine’s Git on every repository', async () => {
    const other = repository(join(work, 'other'))
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        yield* runScript(
          builder,
          main,
          `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(join(work, '.gitconfig'))}, '[core]\\n\\thooksPath = /tmp/h\\n')
`,
        )
        return {
          needs: yield* asked,
          status: yield* engineStatus(main),
          other: yield* engineStatus(other),
        }
      }),
    )
    expect(result.needs).toHaveLength(1)
    expect(shown(result.needs[0])).toContain('~/.gitconfig')
    expect(result.status).toContain('Hemera stopped its Git')
    expect(result.other).toContain('Hemera stopped its Git')
  })

  test('7. a worktree’s config.worktree', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        const linked = join(work, 'acme-wt')
        git(main, 'worktree', 'add', '-q', linked, '-b', 'side')
        yield* runScript(
          builder,
          main,
          `import { writeFileSync } from 'node:fs'
writeFileSync(['.git', 'worktrees', 'acme-wt', 'config.worktree'].join('/'), '[core]\\n\\tfsmonitor = x\\n')
`,
        )
        return {
          needs: yield* asked,
          status: yield* engineStatus(main),
          linked: yield* engineStatus(linked),
        }
      }),
    )
    expect(result.needs).toHaveLength(1)
    expect(shown(result.needs[0])).toContain('~/acme/.git/worktrees/acme-wt/config.worktree')
    expect(result.status).toContain('Hemera stopped its Git')
    expect(result.linked).toContain('Hemera stopped its Git')
  })

  test('8. two changes in one command, one reverted: the net change is asked; both reverted ask nothing', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        const config = join(main, '.git', 'config')
        const original = readFileSync(config, 'utf8')
        // Both undone in the same command: nothing to ask.
        yield* runScript(
          builder,
          main,
          `import { readFileSync, rmSync, writeFileSync } from 'node:fs'
const config = '.git/config'
const was = readFileSync(config)
writeFileSync(config, was + '[core]\\n\\thooksPath = h\\n')
writeFileSync('.git/hooks/pre-push', '#!/bin/sh\\n')
writeFileSync(config, was)
rmSync('.git/hooks/pre-push')
`,
        )
        const quiet = yield* until(guardNeeds, (needs) => needs.length > 0, 1_000)
        const before = yield* engineStatus(main)
        // One kept, one undone: the kept one alone is asked.
        yield* runScript(
          builder,
          main,
          `import { appendFileSync, rmSync, writeFileSync } from 'node:fs'
appendFileSync('.git/config', '[core]\\n\\thooksPath = h\\n')
writeFileSync('.git/hooks/pre-push', '#!/bin/sh\\n')
rmSync('.git/hooks/pre-push')
`,
        )
        return {
          quiet,
          before,
          original,
          needs: yield* asked,
          status: yield* engineStatus(main),
        }
      }),
    )
    expect(result.quiet).toEqual([])
    expect(result.before).toBe('ran')
    expect(result.needs).toHaveLength(1)
    expect(shown(result.needs[0])).toContain('~/acme/.git/config')
    expect(shown(result.needs[0])).not.toContain('pre-push')
    expect(result.status).toContain('Hemera stopped its Git')
  })

  test('9. what the engine’s own Git writes (index, refs, ORIG_HEAD, FETCH_HEAD, logs, packed-refs, a worktree it adds) while an agent’s command runs is never a question', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        // The engine commits here: an identity of the test repository's own, never the machine's,
        // and no line-ending conversion to warn about on Windows.
        git(main, 'config', 'user.name', 'Test')
        git(main, 'config', 'user.email', 'test@example.invalid')
        git(main, 'config', 'core.autocrlf', 'false')
        const origin = remote(main, join(work, 'origin.git'))
        const release = join(work, 'release')
        // The agent's own Git work in the index and the refs, then it waits to be released.
        const running = yield* runScript(
          builder,
          main,
          `import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args])
writeFileSync('notes.txt', 'one\\n')
git('add', 'notes.txt')
git('commit', '-q', '-m', 'notes')
git('reset', '-q', '--soft', 'HEAD~1')
git('pack-refs', '--all')
const wait = () => { if (!existsSync(${JSON.stringify(release)})) setTimeout(wait, 25) }
wait()
`,
        ).pipe(Effect.forkChild)
        yield* until(
          Effect.sync(() => existsSync(join(main, '.git', 'ORIG_HEAD'))),
          (there) => there,
        )
        // Meanwhile the engine fetches, commits and adds a worktree of its own.
        const own = yield* Git.use((service) =>
          Effect.gen(function* () {
            yield* service.fetchBranch(main, 'origin', 'trunk')
            writeFileSync(join(main, 'engine.txt'), 'two\n')
            yield* service.commitPaths(main, ['engine.txt'], 'the engine commits')
            yield* service.worktreeAdd(main, 'mission/side', join(work, 'acme-side'), 'HEAD')
            return 'ran'
          }),
        ).pipe(Effect.catch((refused) => Effect.succeed(refused.message)))
        writeFileSync(release, '')
        yield* Fiber.join(running)
        const needs = yield* until(guardNeeds, (found) => found.length > 0, 1_500)
        return { origin, own, needs, status: yield* engineStatus(main) }
      }),
    )
    expect(result.own).toBe('ran')
    expect(result.needs).toEqual([])
    expect(result.status).toBe('ran')
  })
})

describe('A command still running is watched until it ends (#457)', () => {
  test('a hook a running command wrote stops the engine’s next Git call before the command ends', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        const release = join(work, 'release')
        const hook = join(main, '.git', 'hooks', 'post-commit')
        const running = yield* runScript(
          builder,
          main,
          `import { existsSync, writeFileSync } from 'node:fs'
writeFileSync('.git/hooks/post-commit', '#!/bin/sh\\necho later\\n')
const wait = () => { if (!existsSync(${JSON.stringify(release)})) setTimeout(wait, 25) }
wait()
`,
        ).pipe(Effect.forkChild)
        yield* until(
          Effect.sync(() => existsSync(hook)),
          (there) => there,
        )
        const status = yield* engineStatus(main)
        writeFileSync(release, '')
        yield* Fiber.join(running)
        return { status, needs: yield* asked }
      }),
    )
    expect(result.status).toContain('Hemera stopped its Git')
    expect(result.needs).toHaveLength(1)
    expect(shown(result.needs[0])).toContain('~/acme/.git/hooks/post-commit')
  })

  test('a change another command made and the user allowed is not asked again when a command open meanwhile ends', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        const release = join(work, 'release')
        const started = join(work, 'started')
        const long = yield* runScript(
          builder,
          main,
          `import { existsSync, writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(started)}, '')
const wait = () => { if (!existsSync(${JSON.stringify(release)})) setTimeout(wait, 25) }
wait()
`,
        ).pipe(Effect.forkChild)
        yield* until(
          Effect.sync(() => existsSync(started)),
          (there) => there,
        )
        yield* runScript(
          builder,
          main,
          `import { appendFileSync } from 'node:fs'\nappendFileSync('.git/config', '[core]\\n\\thooksPath = h\\n')\n`,
        )
        const [first] = yield* asked
        if (first !== undefined) yield* allow(first)
        const allowed = yield* engineStatus(main)
        writeFileSync(release, '')
        yield* Fiber.join(long)
        const again = yield* until(guardNeeds, (needs) => needs.length > 0, 1_500)
        return { first, allowed, again, status: yield* engineStatus(main) }
      }),
    )
    expect(shown(result.first)).toContain('hooksPath = h')
    expect(result.allowed).toBe('ran')
    expect(result.again).toEqual([])
    expect(result.status).toBe('ran')
  })
})

describe('A change the user allowed becomes the new baseline; one denied keeps Git stopped (#457)', () => {
  test('a hook manager’s install (core.hooksPath, its hooks) asks once; allowed, the engine’s Git runs and the next command asks nothing', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        const install = `import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
mkdirSync('.husky/_', { recursive: true })
writeFileSync('.husky/_/pre-commit', '#!/bin/sh\\n')
appendFileSync('.git/config', '[core]\\n\\thooksPath = .husky/_\\n')
`
        yield* runScript(builder, main, install)
        const [first] = yield* asked
        const held = yield* engineStatus(main)
        if (first !== undefined) yield* allow(first)
        const after = yield* engineStatus(main)
        // A command that changes nothing of it, then one that only writes the tracked tree.
        yield* runScript(
          builder,
          main,
          `import { writeFileSync } from 'node:fs'\nwriteFileSync('a.txt', 'a')\n`,
        )
        const quiet = yield* until(guardNeeds, (needs) => needs.length > 0, 1_000)
        return { first, held, after, quiet, status: yield* engineStatus(main) }
      }),
    )
    expect(shown(result.first)).toContain('hooksPath = .husky/_')
    expect(result.held).toContain('Hemera stopped its Git')
    expect(result.after).toBe('ran')
    expect(result.quiet).toEqual([])
    expect(result.status).toBe('ran')
  })

  test('allowed after the files changed again, the engine’s Git stays stopped and the new change is asked', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        yield* runScript(
          builder,
          main,
          `import { appendFileSync } from 'node:fs'\nappendFileSync('.git/config', '[core]\\n\\thooksPath = h\\n')\n`,
        )
        const [first] = yield* asked
        // Changed again behind the question's back, by something no window saw.
        git(main, 'config', 'core.fsmonitor', './watch.sh')
        if (first !== undefined) yield* allow(first)
        const status = yield* engineStatus(main)
        const again = yield* until(guardNeeds, (needs) => needs.length > 0)
        return { status, again }
      }),
    )
    expect(result.status).toContain('Hemera stopped its Git')
    expect(result.again).toHaveLength(1)
    expect(shown(result.again[0])).toContain('fsmonitor = ./watch.sh')
  })

  test('denied, the engine’s Git stays stopped and nothing is restored; once the user puts the files back, it runs again', async () => {
    const result = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        const hook = join(main, '.git', 'hooks', 'pre-commit')
        yield* runScript(
          builder,
          main,
          `import { writeFileSync } from 'node:fs'\nwriteFileSync('.git/hooks/pre-commit', '#!/bin/sh\\n')\n`,
        )
        const [first] = yield* asked
        if (first !== undefined) yield* deny(first)
        const denied = yield* engineStatus(main)
        const kept = existsSync(hook)
        rmSync(hook)
        const restored = yield* engineStatus(main)
        return { denied, kept, restored, needs: yield* guardNeeds }
      }),
    )
    expect(result.denied).toContain('Hemera stopped its Git')
    expect(result.kept).toBe(true)
    expect(result.restored).toBe('ran')
    expect(result.needs).toEqual([])
  })
})

describe('A hold outlives a restart of the engine (#457)', () => {
  test('the engine’s Git stays stopped at the next opening until the user answers; allowed, it runs', async () => {
    const first = await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        yield* runScript(
          builder,
          main,
          `import { writeFileSync } from 'node:fs'\nwriteFileSync('.git/hooks/pre-commit', '#!/bin/sh\\necho gotcha\\n')\n`,
        )
        return yield* until(guardNeeds, (needs) => needs.length > 0)
      }),
    )
    const main = join(work, 'acme')
    const reopened = await commandsEngine(data, { tools: { home: work, judge: ALLOWS } })(
      (started) =>
        started.profile.use(
          Effect.gen(function* () {
            const held = yield* engineStatus(main)
            const [need] = yield* guardNeeds
            if (need !== undefined) yield* allow(need)
            return { held, need, after: yield* engineStatus(main) }
          }),
        ),
    )
    expect(first).toHaveLength(1)
    expect(reopened.held).toContain('Hemera stopped its Git')
    expect(reopened.need?.id).toBe(first[0]?.id)
    expect(reopened.after).toBe('ran')
  })

  test('denied before the restart, the engine’s Git stays stopped after it, and nothing is asked again', async () => {
    await withBuilder(({ builder, main }) =>
      Effect.gen(function* () {
        yield* runScript(
          builder,
          main,
          `import { writeFileSync } from 'node:fs'\nwriteFileSync('.git/hooks/pre-commit', '#!/bin/sh\\necho gotcha\\n')\n`,
        )
        const [need] = yield* asked
        if (need !== undefined) yield* deny(need)
      }),
    )
    const main = join(work, 'acme')
    const reopened = await commandsEngine(data, { tools: { home: work, judge: ALLOWS } })(
      (started) =>
        started.profile.use(
          Effect.gen(function* () {
            const held = yield* engineStatus(main)
            const needs = yield* until(guardNeeds, (found) => found.length > 0, 1_000)
            return { held, needs }
          }),
        ),
    )
    expect(reopened.held).toContain('Hemera stopped its Git')
    expect(reopened.needs).toEqual([])
  })
})
