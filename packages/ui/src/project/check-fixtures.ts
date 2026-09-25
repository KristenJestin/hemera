import type { CheckLine, CommandLine, RepositoryLine } from './model.ts'

/**
 * The catalogue, the repositories and the checks of Atlas, for the stories of the Build section
 * (lot 22, D10-06): two repositories, the commands a JavaScript Project declares, and the checks
 * the catalogue's types propose — a type check and a lint after each task in each repository the
 * task changed, the tests after each story, the build and the end-to-end suite at the end.
 */

export const REPOSITORIES: RepositoryLine[] = [
  { path: 'sources/api', branch: 'main', exists: true, includedByDefault: true, icon: 'server' },
  { path: 'sources/front', branch: 'main', exists: true, includedByDefault: true, icon: 'browser' },
]

function command(
  id: string,
  type: CommandLine['type'],
  line: string,
  folderBase: string | null = null,
): CommandLine {
  return {
    id,
    name: id,
    command: line,
    lineWindows: null,
    lineLinux: null,
    type,
    scope: 'workspace',
    portless: false,
    portlessName: null,
    folderBase,
    folder: '',
  }
}

export const COMMANDS: CommandLine[] = [
  command('typecheck', 'lint', 'pnpm tsc --noEmit'),
  command('lint', 'lint', 'pnpm oxlint'),
  command('test', 'test', 'pnpm vitest run'),
  command('e2e', 'test', 'pnpm playwright test'),
  command('build', 'build', 'pnpm build'),
  command('dev', 'serve', 'pnpm dev', 'sources/front'),
]

function check(id: string, more: Partial<CheckLine>): CheckLine {
  return {
    id,
    name: id,
    commandId: id,
    line: null,
    where: 'changed',
    repository: null,
    when: 'task',
    expect: null,
    files: null,
    ...more,
  }
}

/** What the catalogue's types propose (D10-06), nothing of it saved. */
export const PROPOSED: CheckLine[] = [
  check('typecheck', {}),
  check('lint', {}),
  check('test', { when: 'story' }),
  check('build', { where: 'root', when: 'end' }),
  check('e2e', { where: 'root', when: 'end' }),
]

/** A type check, after each task, in each repository the task changed. */
export const TYPECHECK = check('typecheck', {})

/** A coverage minimum on the front, after each story (L4). */
export const COVERAGE = check('coverage', {
  commandId: null,
  line: 'pnpm vitest run --coverage',
  where: 'repository',
  repository: 'sources/front',
  when: 'story',
  expect: { pattern: 'All files\\s*\\|\\s*([\\d.]+)', minimum: 70 },
})

/** The end-to-end tests the task wrote, and only those. */
export const E2E_WRITTEN = check('e2e written', {
  commandId: null,
  line: 'pnpm playwright test {files}',
  where: 'root',
  files: 'e2e/**/*.e2e.ts',
})

/** The checks Atlas saved: the proposals, a coverage minimum, and the e2e the task wrote. */
export const CHECKS: CheckLine[] = [
  TYPECHECK,
  check('lint', {}),
  COVERAGE,
  E2E_WRITTEN,
  check('build', { where: 'root', when: 'end' }),
]
