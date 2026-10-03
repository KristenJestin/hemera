/**
 * The rules of the command catalogue: how a line is read without a shell, the shell syntax it
 * refuses, the line each system runs, the write globs a command declares, the address a service
 * publishes, and its Portless name.
 */

import { Result } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  COMMAND_TYPES,
  InvalidCommand,
  ShellSyntax,
  addressIn,
  checkedLine,
  lineFor,
  portOf,
  portlessName,
  portlessNameFor,
  runsPortless,
  shellSyntaxIn,
  wordsOf,
  writeGlob,
} from '../src/domain/index.ts'

const refusal = <A, E>(result: Result.Result<A, E>): E | undefined =>
  Result.isFailure(result) ? result.failure : undefined
const value = <A, E>(result: Result.Result<A, E>): A | undefined =>
  Result.isSuccess(result) ? result.success : undefined

describe('A line is split into words without a shell', () => {
  test('quotes keep a word whole and are dropped', () => {
    expect(wordsOf(`node -e "console.log('a b')" 'x  y' plain`)).toEqual([
      'node',
      '-e',
      "console.log('a b')",
      'x  y',
      'plain',
    ])
  })

  test('a backslash is a character like another, as a Windows path writes it', () => {
    expect(wordsOf('C:\\tools\\run.exe --out C:\\out')).toEqual([
      'C:\\tools\\run.exe',
      '--out',
      'C:\\out',
    ])
  })

  test('an empty pair of quotes is an empty word', () => {
    expect(wordsOf(`run "" ''`)).toEqual(['run', '', ''])
  })
})

describe('Shell syntax is refused, naming the token', () => {
  const refused: ReadonlyArray<readonly [string, string]> = [
    ['pnpm lint | tee out', '|'],
    ['pnpm lint || true', '||'],
    ['pnpm dev &', '&'],
    ['pnpm install && pnpm dev', '&&'],
    ['pnpm lint; pnpm test', ';'],
    ['pnpm test < input', '<'],
    ['pnpm test > out.txt', '>'],
    ['pnpm test >> out.txt', '>>'],
    ['pnpm test 2>&1', '2>&1'],
    ['pnpm test 2> errors.txt', '2>'],
    ['echo $(whoami)', '$('],
    ['echo `whoami`', '`'],
    ['echo $HOME', '$HOME'],
    ['echo ${HOME}', '${'],
    ['echo %USERPROFILE%', '%USERPROFILE%'],
    ['pnpm lint\npnpm test', 'a newline'],
    ['rm build/*', '*'],
    ['ls file?.txt', '?'],
    ['ls file[12].txt', '[…]'],
    ['cat ~/notes', '~'],
    // Inside double quotes, everything but a glob and `~` is still the shell's.
    ['echo "a && b"', '&&'],
    ['echo "$HOME"', '$HOME'],
  ]

  test.each(refused)('%s is refused with %s named', (line, token) => {
    const found = refusal(checkedLine(line))
    expect(found).toBeInstanceOf(ShellSyntax)
    expect(found?.token).toBe(token)
    expect(found?.message).toContain(`“${token}”`)
    expect(found?.message).toContain('script of the repository')
  })

  test.each([
    `echo 'a | b'`,
    `echo 'a && b'`,
    `echo 'a; b > c'`,
    `echo '$HOME $(x) \`y\` %PATH%'`,
    `echo '*.ts ~ [ab]'`,
  ])('the same tokens inside single quotes are literal: %s', (line) => {
    expect(shellSyntaxIn(line)).toBeNull()
    expect(value(checkedLine(line))).toBe(line)
  })

  test('a glob or a ~ inside double quotes is literal', () => {
    for (const line of ['prettier --write "src/**/*.ts"', 'ls "file?.txt"', 'cat "~/x" "[ab]"']) {
      expect(shellSyntaxIn(line)).toBeNull()
    }
  })

  test('what only looks like syntax is a word', () => {
    for (const line of [
      'vite --port 5173',
      'node a-b.js --name=x',
      'echo 50% done',
      'echo $',
      'eslint --rule {a:1}',
      'run user@host:path',
    ]) {
      expect(shellSyntaxIn(line)).toBeNull()
    }
  })
})

describe('Each system runs its own line', () => {
  const carried = { line: 'pnpm dev', lineWindows: 'pnpm.cmd dev', lineLinux: null }

  test('Windows its own, Linux the default when it has none, macOS the default', () => {
    expect(lineFor(carried, 'win32')).toBe('pnpm.cmd dev')
    expect(lineFor(carried, 'linux')).toBe('pnpm dev')
    expect(lineFor({ ...carried, lineLinux: 'npm run dev' }, 'linux')).toBe('npm run dev')
    expect(lineFor(carried, 'darwin')).toBe('pnpm dev')
  })
})

describe('A write glob is relative to its place', () => {
  test('kept in one spelling', () => {
    expect(value(writeGlob(' src/**/*.ts '))).toBe('src/**/*.ts')
    expect(value(writeGlob('.\\generated\\client.ts'))).toBe('generated/client.ts')
    expect(value(writeGlob('pnpm-lock.yaml'))).toBe('pnpm-lock.yaml')
    expect(value(writeGlob('{a,b}/*.json'))).toBe('{a,b}/*.json')
  })

  test('empty, absolute, climbing out, or never closed is refused with its reason', () => {
    for (const [glob, reason] of [
      ['', 'it is empty'],
      ['/etc/*', 'it is absolute'],
      ['C:/out/*', 'it is absolute'],
      ['../other/*', 'it leaves the folder of the command'],
      ['src/[ab', 'a “[” is never closed'],
      ['src/{a,b', 'a “{” is never closed'],
    ] as const) {
      const found = refusal(writeGlob(glob))
      expect(found).toBeInstanceOf(InvalidCommand)
      expect(found?.message).toContain(reason)
    }
  })
})

describe('A service publishes the first address it prints', () => {
  test('on the machine name and each loopback spelling, with a port', () => {
    expect(addressIn('ready on http://localhost:5173/')).toBe('http://localhost:5173')
    expect(addressIn('listening at http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(addressIn('bound to http://0.0.0.0:8080')).toBe('http://0.0.0.0:8080')
    expect(addressIn('serving https://[::1]:4443/app')).toBe('https://[::1]:4443')
    expect(addressIn('open http://localhost/ in a browser')).toBeNull()
    expect(addressIn('nothing here but https://example.com:443')).toBeNull()
  })

  test('through the colour codes a terminal paints it with', () => {
    const painted =
      '  \u001b[32m➜\u001b[39m  Local: \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m'
    expect(addressIn(painted)).toBe('http://localhost:5173')
  })

  test('a `*.localhost` name, with or without a port', () => {
    expect(addressIn('at http://web.atlas.localhost:1355 now')).toBe(
      'http://web.atlas.localhost:1355',
    )
    expect(addressIn('at https://atlas.localhost now')).toBe('https://atlas.localhost')
    expect(portOf('http://web.atlas.localhost:1355')).toBe(1355)
    expect(portOf('https://atlas.localhost')).toBeNull()
    expect(portOf('https://[::1]:4443')).toBe(4443)
  })
})

describe('A Portless service runs under one name', () => {
  test("its own name, or the Project's as a slug", () => {
    expect(portlessNameFor(null, 'Atlas Web')).toBe('atlas-web')
    expect(portlessNameFor('api', 'Atlas Web')).toBe('api')
  })

  test('a name of its own is one word, and a blank one is none', () => {
    expect(value(portlessName('  api '))).toBe('api')
    expect(value(portlessName('  '))).toBeNull()
    expect(refusal(portlessName('my api'))).toBeInstanceOf(InvalidCommand)
  })

  test('a line that runs portless itself is recognised', () => {
    expect(runsPortless('portless atlas pnpm dev')).toBe(true)
    expect(runsPortless('C:\\bin\\portless.cmd atlas pnpm dev')).toBe(true)
    expect(runsPortless('pnpm dev')).toBe(false)
  })
})

describe('The catalogue knows its types', () => {
  test('typecheck and e2e are types of their own', () => {
    expect(COMMAND_TYPES).toEqual([
      'serve',
      'test',
      'lint',
      'typecheck',
      'build',
      'e2e',
      'configure',
      'debug',
      'script',
    ])
  })
})
