/**
 * Hemera's local rules: the policy as data, the effective action a line runs through its
 * wrappers and shell strings, the refusals (a deletion of `.git`, what no agent of a mission may
 * run, the "never" list) and the narrow local allows.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  FORGE_READS,
  NeverCommand,
  NeverProgram,
  PERMISSION_POLICY,
  type PlaceContext,
  chatMustAsk,
  deletesGit,
  effectiveAction,
  missionRefusal,
  neverMatch,
  plainListing,
  unwrapped,
} from '../src/domain/index.ts'

const LINUX: PlaceContext = { home: '/home/me', user: 'me', platform: 'linux' }
const WINDOWS: PlaceContext = { home: 'C:\\Users\\me', user: 'me', platform: 'win32' }

/** The refusal of a line for an agent of a mission, read as the order reads it. */
const refusalOf = (words: ReadonlyArray<string>, mayCommit = false, context = LINUX) =>
  missionRefusal(effectiveAction(words, context).sequences, mayCommit)

describe('The policy is versioned data with one level', () => {
  test('version 1, level Normal, its thresholds', () => {
    expect(PERMISSION_POLICY).toEqual({
      policyVersion: 1,
      level: 'normal',
      alwaysAskRisk: 2.5,
      askRisk: 1.5,
      askApproval: 0.75,
      userRequestedLifts: 0.85,
    })
  })
})

describe('The effective action unwraps the wrappers, repeatedly', () => {
  test.each([
    [
      ['npx', 'gh', 'pr', 'merge', '1'],
      ['gh', 'pr', 'merge', '1'],
    ],
    [
      ['npx', '--yes', '-p', 'gh', 'gh', 'pr', 'merge'],
      ['gh', 'pr', 'merge'],
    ],
    [
      ['pnpm', 'exec', 'git', 'push'],
      ['git', 'push'],
    ],
    [
      ['pnpm', 'dlx', 'gh', 'release', 'create'],
      ['gh', 'release', 'create'],
    ],
    [
      ['yarn', 'gh', 'pr', 'merge'],
      ['gh', 'pr', 'merge'],
    ],
    [
      ['yarn', 'exec', 'git', 'push'],
      ['git', 'push'],
    ],
    [
      ['env', 'A=1', 'B=2', 'git', 'push'],
      ['git', 'push'],
    ],
    [
      ['env', '-u', 'HOME', 'git', 'push'],
      ['git', 'push'],
    ],
    [
      ['command', 'git', 'push'],
      ['git', 'push'],
    ],
    [
      ['time', '-p', 'git', 'push'],
      ['git', 'push'],
    ],
    [
      ['A=1', 'time', 'env', 'npx', 'pnpm', 'exec', 'git', 'push'],
      ['git', 'push'],
    ],
    [
      ['sudo', '-u', 'root', 'git', 'push'],
      ['git', 'push'],
    ],
    [
      ['pnpm', 'publish'],
      ['pnpm', 'publish'],
    ],
    [
      ['git', 'status'],
      ['git', 'status'],
    ],
  ])('%j runs %j', (words, program) => {
    expect(unwrapped(words)).toEqual(program)
  })

  test('a shell string is read, and each of its commands unwrapped', () => {
    expect(
      effectiveAction(['sh', '-c', 'cd app && env X=1 npx gh pr merge 1'], LINUX).programs,
    ).toContainEqual(['gh', 'pr', 'merge', '1'])
  })

  test('a wrapper that hands its program a way this does not read is not certain', () => {
    expect(effectiveAction(['env', '-S', 'git push'], LINUX).unreadable).not.toBeNull()
    expect(effectiveAction(['npx', '-c', 'git push'], LINUX).unreadable).not.toBeNull()
  })
})

describe('A deletion of .git is refused wherever it hides', () => {
  test.each([
    ['rm', '-rf', '.git'],
    ['rm', '-rf', './.git/'],
    ['rm', '--recursive', '--force', '/home/me/repo/.git/objects'],
    ['sh', '-c', 'cd repo && rm -rf .git'],
    ['npx', 'rimraf', 'x', '&&', 'rm', '.git'],
    ['/bin/rm', '-Rf', '.git'],
    ['rm.exe', '-rf', '.GIT'],
    ['unlink', '.git/index'],
    ['rmdir', '/s', '/q', '.git'],
    ['rd', '/s', '/q', 'C:\\repo\\.git\\'],
    ['del', '/s', '/q', '.git'],
    ['erase', '.git\\HEAD'],
    ['cmd', '/c', 'rmdir /s /q .git'],
    ['powershell', '-Command', 'Remove-Item -Recurse -Force .git'],
    ['pwsh.exe', '-c', 'ri -r .git'],
    ['shred', '-u', '.git/config'],
    ['sudo', 'sh', '-c', 'rm -rf .git'],
  ])('%j', (...words) => {
    expect(deletesGit(words)).toBe(true)
  })

  test.each([
    ['rm', '.gitignore'],
    ['rm', '-rf', '.github'],
    ['git', 'rm', 'notes.md'],
    ['ls', '.git'],
  ])('%j is not one', (...words) => {
    expect(deletesGit(words)).toBe(false)
  })
})

describe('No agent of a mission writes to a remote or to the history', () => {
  const refused = [
    ['git', 'push'],
    ['git', 'push', 'origin', 'main'],
    ['git', '-C', 'app', 'push'],
    ['git', '-c', 'user.name=x', 'merge', 'feature'],
    ['git', 'rebase', 'main'],
    ['git', 'reset', '--hard', 'HEAD~1'],
    ['git', 'tag', 'v1.0.0'],
    ['git', 'switch', 'main'],
    ['git', 'checkout', 'main'],
    ['git', 'checkout', '-b', 'other'],
    ['git', 'branch', '-d', 'old'],
    ['git', 'branch', '-D', 'old'],
    ['git', 'branch', '--delete', 'old'],
    ['git.exe', 'push'],
    ['/usr/bin/git', 'push'],
    ['git', 'commit', '-m', 'wip'],
  ]
  const wrappers: ReadonlyArray<(words: ReadonlyArray<string>) => ReadonlyArray<string>> = [
    (words) => words,
    (words) => ['npx', ...words],
    (words) => ['pnpm', 'exec', ...words],
    (words) => ['pnpm', 'dlx', ...words],
    (words) => ['yarn', ...words],
    (words) => ['env', 'A=1', ...words],
    (words) => ['command', ...words],
    (words) => ['time', ...words],
    (words) => ['sh', '-c', words.map((word) => `'${word}'`).join(' ')],
    (words) => ['bash', '-lc', `sh -c "${words.join(' ')}"`],
  ]
  test.each(refused.flatMap((words) => wrappers.map((wrap) => [wrap(words)])))(
    '%j is refused',
    (words) => {
      expect(refusalOf(words)).toMatch(/^no agent of a mission may/)
    },
  )

  test.each([
    [['git', 'status']],
    [['git', 'diff', 'HEAD']],
    [['git', 'log', '--oneline']],
    [['git', 'tag', '--list']],
    [['git', 'tag', '-l', 'v*']],
    [['git', 'checkout', '--', 'src/app.ts']],
    [['git', 'branch', '--show-current']],
    [['git', 'add', 'src']],
    [['grep', '-r', 'git push', 'docs']],
  ])('%j is not refused', (words) => {
    expect(refusalOf(words)).toBeNull()
  })

  test('git commit is allowed when the Project gives its agents that right', () => {
    expect(refusalOf(['git', 'commit', '-m', 'x'], true)).toBeNull()
    expect(refusalOf(['git', 'commit', '-m', 'x'], false)).toBe(
      'no agent of a mission may run git commit in this Project',
    )
  })
})

describe("A forge CLI's writes are refused, its reads are not", () => {
  const reads = (['gh', 'glab', 'bkt'] as const).flatMap((cli) =>
    FORGE_READS[cli]
      .filter((read) => read !== 'api')
      .map((read) => [cli, read.split(' '), '1'].flat()),
  )
  test.each(reads.map((words) => [words]))('%j reads', (words) => {
    expect(refusalOf(words)).toBeNull()
    expect(refusalOf(['npx', ...words])).toBeNull()
  })

  test.each([
    [['gh', 'api', 'repos/acme/app/pulls']],
    [['gh', 'api', '-X', 'GET', 'repos/acme/app']],
    [['glab', 'api', '--method=GET', 'projects']],
    [['bkt', 'api', 'repositories']],
  ])('%j reads', (words) => {
    expect(refusalOf(words)).toBeNull()
  })

  test.each([
    [['gh', 'pr', 'merge', '1']],
    [['gh', 'pr', 'create', '--fill']],
    [['gh', 'pr', 'close', '1']],
    [['gh', 'issue', 'comment', '1', '-b', 'x']],
    [['gh', 'release', 'create', 'v1']],
    [['gh', 'repo', 'delete']],
    [['gh', 'api', '-X', 'POST', 'repos/acme/app/issues']],
    [['gh', 'api', '--method=DELETE', 'repos/acme/app']],
    [['gh', 'api', 'repos/acme/app/issues', '-f', 'title=x']],
    [['gh', 'api', 'graphql', '-F', 'query=@q.graphql']],
    [['gh', 'api', 'repos/x', '--input', 'body.json']],
    [['glab', 'mr', 'merge', '1']],
    [['glab', 'mr', 'create']],
    [['glab', 'api', '-X', 'PUT', 'projects/1']],
    [['bkt', 'pr', 'merge', '1']],
    [['bkt', 'pr', 'create']],
    [['npx', 'gh', 'pr', 'merge', '1']],
    [['sh', '-c', 'gh pr merge 1']],
  ])('%j is refused', (words) => {
    expect(refusalOf(words)).toMatch(/beyond its reads$/)
  })
})

describe('No agent of a mission publishes a package', () => {
  test.each([
    [['npm', 'publish']],
    [['npm', '--registry', 'https://registry.example', 'publish']],
    [['pnpm', 'publish', '--no-git-checks']],
    [['yarn', 'publish']],
    [['yarn', 'npm', 'publish']],
    [['bun', 'publish']],
    [['cargo', 'publish']],
    [['twine', 'upload', 'dist/*']],
    [['gem', 'push', 'acme-1.0.0.gem']],
    [['dotnet', 'nuget', 'push', 'acme.nupkg']],
    [['npx', 'npm', 'publish']],
    [['env', 'NODE_AUTH_TOKEN=x', 'npm', 'publish']],
    [['cmd', '/c', 'npm publish']],
  ])('%j is refused', (words) => {
    expect(refusalOf(words, false, WINDOWS)).toMatch(/^no agent of a mission may publish/)
  })

  test.each([[['npm', 'test']], [['pnpm', 'install']], [['cargo', 'build']]])(
    '%j is not refused',
    (words) => {
      expect(refusalOf(words)).toBeNull()
    },
  )
})

describe('A "never" entry refuses a call that begins with it', () => {
  const deploy = NeverProgram.make({ words: ['make', 'deploy'] })
  const seed = NeverCommand.make({ commandId: 'seed' })
  const match = (words: ReadonlyArray<string>, commandId: string | null = null) =>
    neverMatch([deploy, seed], effectiveAction(words, LINUX).sequences, commandId, 'linux')

  test.each([
    [['make', 'deploy']],
    [['make', 'deploy', 'STAGE=prod']],
    [['/usr/bin/make', 'deploy']],
    [['npx', 'make', 'deploy']],
    [['env', 'A=1', 'make', 'deploy']],
    [['sh', '-c', 'make deploy']],
    [['time', 'make', 'deploy']],
  ])('%j matches make deploy', (words) => {
    expect(match(words)).toEqual(deploy)
  })

  test('a call that does not begin with it, or another command, does not match', () => {
    expect(match(['make', 'build'])).toBeNull()
    expect(match(['make'])).toBeNull()
    expect(match(['node', 'run.js'], 'build')).toBeNull()
  })

  test('the listed catalogue command matches', () => {
    expect(match(['node', 'seed.js'], 'seed')).toEqual(seed)
  })
})

describe('A plain listing inside is the only command allowed by the rules', () => {
  const listing = (program: string, args: ReadonlyArray<string>, resolved: string | null) =>
    plainListing({ program, args, shell: false, resolved })

  test.each([
    ['ls', [], '/usr/bin/ls'],
    ['ls', ['-la', 'src/app', 'docs'], '/bin/ls'],
    ['/usr/bin/ls', ['-1'], '/usr/bin/ls'],
    ['dir', ['src'], '/usr/bin/dir'],
    ['ls', ['src\\app'], 'C:\\Program Files\\Git\\usr\\bin\\ls.exe'],
  ] as const)('%s %j resolved at %s is a plain listing', (program, args, resolved) => {
    expect(listing(program, args, resolved)).toBe(true)
  })

  test.each([
    ['ls', ['../outside'], '/usr/bin/ls'],
    ['ls', ['/etc'], '/usr/bin/ls'],
    ['ls', ['--hide=x'], '/usr/bin/ls'],
    ['ls', ['$(rm -rf build)'], '/usr/bin/ls'],
    ['ls', ['*'], '/usr/bin/ls'],
    ['ls', [], null],
    ['ls', [], '/tmp/evil/ls-wrapper'],
    ['./ls', [], '/work/ls'],
    ['ls', ['C:\\Windows'], 'C:\\Git\\usr\\bin\\ls.exe'],
  ] as const)('%s %j resolved at %s is not', (program, args, resolved) => {
    expect(listing(program, args, resolved)).toBe(false)
  })

  test('through a shell, never', () => {
    expect(plainListing({ program: 'ls', args: [], shell: true, resolved: '/usr/bin/ls' })).toBe(
      false,
    )
  })
})

describe('What the Chat always asks before, through any wrapper (#43)', () => {
  const askedOf = (words: ReadonlyArray<string>) =>
    chatMustAsk(effectiveAction(words, LINUX).sequences)

  test.each([
    [['git', 'push'], 'the Chat always asks before git push'],
    [['git', '-C', 'api', 'push', 'origin', 'main'], 'the Chat always asks before git push'],
    [['sh', '-c', 'git push'], 'the Chat always asks before git push'],
    [['env', 'GIT_TRACE=1', 'git', 'push'], 'the Chat always asks before git push'],
    [['npx', 'gh', 'pr', 'create'], 'the Chat always asks before gh writes to the forge'],
    [
      ['pnpm', 'exec', 'glab', 'mr', 'merge'],
      'the Chat always asks before glab writes to the forge',
    ],
    [['npm', 'publish'], 'the Chat always asks before publishing a package (npm)'],
    [['cargo', 'publish'], 'the Chat always asks before publishing a package (cargo)'],
  ])('%j asks', (words, reason) => {
    expect(askedOf(words)).toBe(reason)
  })

  test.each([
    [['git', 'commit', '-m', 'Export as JSON']],
    [['git', 'status']],
    [['gh', 'pr', 'view', '3']],
    [['gh', 'api', 'repos/acme/api/pulls']],
    [['npm', 'test']],
  ])('%j is left to the rest of the order', (words) => {
    expect(askedOf(words)).toBeNull()
  })
})
