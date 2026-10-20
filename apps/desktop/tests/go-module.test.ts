/**
 * The Go module of a proof's test file (#462): the `go.mod` nearest above the file, up to its
 * repository's folder, read on the engine's own behalf: never through a link leading out of the
 * repository, never a pipe waited on, never more than a cap. A nearer `go.mod` that does not read
 * names no module: a farther one never decides in its place.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { GO_MOD_CAP, goModuleOf } from '../src/engine/building/go-module.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let work: string
let api: string

beforeEach(() => {
  work = realpathSync.native(temporaryFolder('go-module'))
  api = join(work, 'api')
  mkdirSync(api)
})
afterEach(removeFolders)

const POSIX = process.platform !== 'win32'

/** Writes a file of `api`, its folders made. */
const written = (path: string, text: string) => {
  const file = join(api, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

/** The module of `api`'s test file at `path`. */
const moduleOf = (path: string) => goModuleOf(work, api, path)

describe('A Go test file’s module is read from its nearest go.mod (#462)', () => {
  test('the go.mod at the repository’s root names the module of a test file in a folder', async () => {
    written('go.mod', 'module example.com/m\n\ngo 1.22\n')
    written('internal/pkg/saves_test.go', 'package pkg\n')
    expect(await moduleOf('internal/pkg/saves_test.go')).toEqual({
      path: 'example.com/m',
      folder: '',
    })
    expect(await moduleOf('saves_test.go')).toEqual({ path: 'example.com/m', folder: '' })
  })

  test('in nested modules the nearest go.mod wins', async () => {
    written('go.mod', 'module example.com/m\n')
    written('tools/go.mod', 'module example.com/tools\r\n')
    expect(await moduleOf('tools/gen/saves_test.go')).toEqual({
      path: 'example.com/tools',
      folder: 'tools',
    })
    expect(await moduleOf('tools/saves_test.go')).toEqual({
      path: 'example.com/tools',
      folder: 'tools',
    })
    expect(await moduleOf('internal/pkg/saves_test.go')).toEqual({
      path: 'example.com/m',
      folder: '',
    })
  })

  test('a go.work workspace does not make a module: each file is its nearest go.mod’s', async () => {
    written('go.work', 'go 1.22\n\nuse (\n\t./a\n\t./b\n)\n')
    written('a/go.mod', 'module example.com/a\n')
    written('b/go.mod', 'module example.com/b\n')
    expect(await moduleOf('a/pkg/saves_test.go')).toEqual({ path: 'example.com/a', folder: 'a' })
    expect(await moduleOf('b/saves_test.go')).toEqual({ path: 'example.com/b', folder: 'b' })
    expect(await moduleOf('c/saves_test.go')).toBeNull()
  })

  test('a Windows path of the test file finds the same go.mod', async () => {
    written('go.mod', 'module example.com/m\n')
    written('tools/go.mod', 'module example.com/tools\n')
    expect(await moduleOf('tools\\gen\\saves_test.go')).toEqual({
      path: 'example.com/tools',
      folder: 'tools',
    })
  })

  test('no go.mod up to the repository’s folder is no module, whatever lies above it', async () => {
    writeFileSync(join(work, 'go.mod'), 'module example.com/outer\n')
    expect(await moduleOf('internal/pkg/saves_test.go')).toBeNull()
  })

  test('a go.mod that names no module for certain names none: a farther one never decides', async () => {
    written('go.mod', 'module example.com/m\n')
    written('pkg/go.mod', '// module example.com/pkg\ngo 1.22\n')
    expect(await moduleOf('pkg/saves_test.go')).toBeNull()
  })
})

describe('A go.mod read on the engine’s own behalf (#462)', () => {
  /** `api` with a module at its root, and `pkg/go.mod` made by `make`: the module of pkg's test. */
  const nearer = async (make: (file: string) => void) => {
    written('go.mod', 'module example.com/m\n')
    mkdirSync(join(api, 'pkg'))
    make(join(api, 'pkg', 'go.mod'))
    return moduleOf('pkg/saves_test.go')
  }

  test('a go.mod over the cap is not read: no module, never the farther one', async () => {
    const text = `module example.com/pkg\n${'// padding\n'.repeat(GO_MOD_CAP / 10)}`
    expect(text.length).toBeGreaterThan(GO_MOD_CAP)
    expect(await nearer((file) => writeFileSync(file, text))).toBeNull()
  })

  test('a go.mod at the cap is read', async () => {
    const head = 'module example.com/pkg\n'
    const text = `${head}${'/'.repeat(GO_MOD_CAP - head.length)}`
    expect(text.length).toBe(GO_MOD_CAP)
    expect(await nearer((file) => writeFileSync(file, text))).toEqual({
      path: 'example.com/pkg',
      folder: 'pkg',
    })
  })

  test.skipIf(!POSIX || process.getuid?.() === 0)(
    'a go.mod it may not open is no module, never the farther one',
    async () => {
      expect(
        await nearer((file) => {
          writeFileSync(file, 'module example.com/pkg\n')
          chmodSync(file, 0o000)
        }),
      ).toBeNull()
    },
  )

  test.skipIf(!POSIX)('a go.mod that is a pipe is refused at once, never waited on', async () => {
    expect(await nearer((file) => execFileSync('mkfifo', [file]))).toBeNull()
  })

  test('a folder named go.mod is no module, never the farther one', async () => {
    expect(await nearer((file) => mkdirSync(file))).toBeNull()
  })

  test('a go.mod linked to a file outside the repository is never read through', async (context) => {
    mkdirSync(join(work, 'outside'))
    const outside = join(work, 'outside', 'go.mod')
    writeFileSync(outside, 'module example.com/outside\n')
    let linked = true
    const found = await nearer((file) => {
      try {
        symlinkSync(outside, file, 'file')
      } catch {
        linked = false
      }
    })
    if (!linked) context.skip()
    expect(found).toBeNull()
  })

  test('a folder linked outside the repository is never read through', async (context) => {
    mkdirSync(join(work, 'outside'))
    writeFileSync(join(work, 'outside', 'go.mod'), 'module example.com/outside\n')
    written('go.mod', 'module example.com/m\n')
    try {
      symlinkSync(join(work, 'outside'), join(api, 'pkg'), 'junction')
    } catch {
      context.skip()
    }
    expect(await moduleOf('pkg/saves_test.go')).toBeNull()
  })

  test('a go.mod linked to nothing is no module, never the farther one', async (context) => {
    let linked = true
    const found = await nearer((file) => {
      try {
        symlinkSync(join(api, 'pkg', 'gone.mod'), file, 'file')
      } catch {
        linked = false
      }
    })
    if (!linked) context.skip()
    expect(found).toBeNull()
  })

  test('a go.mod linked to another file of the repository is followed', async (context) => {
    written('shared/go.mod.txt', 'module example.com/shared\n')
    let linked = true
    const found = await nearer((file) => {
      try {
        symlinkSync(join(api, 'shared', 'go.mod.txt'), file, 'file')
      } catch {
        linked = false
      }
    })
    if (!linked) context.skip()
    expect(found).toEqual({ path: 'example.com/shared', folder: 'pkg' })
  })
})
