import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '..', '..', '..')
const surface = join(repository, 'packages', 'ui', 'src', 'index.ts').replaceAll('\\', '/')

/** Typechecks a snippet against the public surface and returns the compiler output. */
function typecheck(snippet: string): { ok: boolean; output: string } {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-primitives-'))
  try {
    const file = join(directory, 'snippet.tsx')
    writeFileSync(file, snippet)
    const result = Bun.spawnSync(
      [
        join(repository, 'node_modules', '.bin', 'tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'esnext',
        '--module',
        'preserve',
        '--moduleResolution',
        'bundler',
        '--allowImportingTsExtensions',
        '--skipLibCheck',
        '--jsx',
        'react-jsx',
        '--jsxImportSource',
        join(repository, 'packages', 'ui', 'node_modules', '@gpuix', 'react').replaceAll('\\', '/'),
        file,
      ],
      { cwd: repository, stdout: 'pipe', stderr: 'pipe' },
    )
    return {
      ok: result.exitCode === 0,
      output: new TextDecoder().decode(result.stdout),
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('Texte sans couleur refusé', () => {
  test('a Text without a colour role fails the typecheck', () => {
    const result = typecheck(
      [`import { Text } from '${surface}'`, '', 'export const run = <Text>Session</Text>', ''].join(
        '\n',
      ),
    )
    expect(result.ok).toBe(false)
    expect(result.output).toContain("'color'")
  })

  test('a Text with a colour role compiles', () => {
    const result = typecheck(
      [
        `import { Text } from '${surface}'`,
        '',
        'export const run = <Text color="muted">Session</Text>',
        '',
      ].join('\n'),
    )
    expect(result.output).toBe('')
    expect(result.ok).toBe(true)
  })

  test('a literal colour instead of a role fails the typecheck', () => {
    const result = typecheck(
      [
        `import { Text } from '${surface}'`,
        '',
        'export const run = <Text color="#18181e">Session</Text>',
        '',
      ].join('\n'),
    )
    expect(result.ok).toBe(false)
    expect(result.output).toContain('#18181e')
  })
})

describe('Variante manquante', () => {
  test('a size the icon scale does not declare fails the typecheck', () => {
    const result = typecheck(
      [
        `import { Icon } from '${surface}'`,
        '',
        'export const run = <Icon name="plus" size="huge" />',
        '',
      ].join('\n'),
    )
    expect(result.ok).toBe(false)
    expect(result.output).toContain('huge')
  })
})
