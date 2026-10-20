// DIAG #522, temporary: how a read of a Git index fails while Git replaces it, on this machine.
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { shapesOf } from './src/engine/git-shapes.ts'

const folder = mkdtempSync(join(tmpdir(), 'diag522-'))
const git = (...args) => execFileSync('git', args, { cwd: folder, stdio: 'pipe' })
git('init', '-q', '-b', 'main')
git('config', 'user.name', 'Diag')
git('config', 'user.email', 'diag@example.com')
writeFileSync(join(folder, 'a.txt'), '0\n')
git('add', '-A')
git('commit', '-q', '-m', '0')
const index = join(folder, '.git', 'index')
const loop = `
const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const { join } = require('node:path')
const folder = process.argv[1]
for (let i = 1; i <= 300; i += 1) {
  writeFileSync(join(folder, 'a.txt'), String(i) + '\\n')
  writeFileSync(join(folder, 'b' + (i % 7) + '.txt'), String(i) + '\\n')
  execFileSync('git', ['add', '-A'], { cwd: folder, stdio: 'pipe' })
  execFileSync('git', ['commit', '-q', '-m', String(i)], { cwd: folder, stdio: 'pipe' })
}
`
const child = spawn(process.execPath, ['-e', loop, folder], { stdio: 'inherit' })
let done = false
child.on('exit', () => (done = true))
const counts = new Map()
const count = (key) => counts.set(key, (counts.get(key) ?? 0) + 1)
const tick = () => new Promise((resolve) => setImmediate(resolve))
while (!done) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const named = lstatSync(index, { bigint: true })
      const file = openSync(index, constants.O_RDONLY)
      try {
        const stats = fstatSync(file, { bigint: true })
        if (stats.ino !== named.ino || stats.dev !== named.dev) count('raw:inode-changed')
        else {
          const bytes = Buffer.alloc(Number(stats.size))
          readSync(file, bytes, 0, bytes.length, 0)
          count('raw:ok')
        }
      } finally {
        closeSync(file)
      }
    } catch (cause) {
      count(`raw:${cause.code ?? 'error'}`)
    }
    const said = shapesOf([folder], { home: folder, configHome: join(folder, 'config') }).get(index)
    count(said === undefined ? 'shapes:read' : `shapes:said:${said.text?.trim()}`)
  }
  await tick()
}
console.log(`DIAG522 ${process.platform} ${JSON.stringify(Object.fromEntries(counts), null, 1)}`)
