import type { BudgetLimit } from './budget.tsx'
import type { AgentInstructions, RepositoryInstructions } from './instructions.tsx'
import type { NeverLine } from './never.tsx'
import { AGENTS } from '../../components/model-picker/model-picker-fixtures.ts'
import type { PickerAgent, PickerModel } from '../../components/model-picker/model-picker.tsx'
import type { ProjectRoleModel } from './role-models.tsx'

/**
 * The neutral case the agent and permission sections of Acme's settings are drawn on: the commands
 * never run in it, the model each role runs on, the cap and the budget, and the instruction files
 * of its repositories. Nothing here is a real Project.
 */
export const NEVER_LINES: readonly NeverLine[] = [
  { id: 'n1', line: 'git push --force' },
  { id: 'n2', line: 'pnpm publish' },
  { id: 'n3', line: 'docker system prune --all' },
  { id: 'n4', line: 'terraform apply' },
]

/** A long line in the list: what a real refusal can hold. */
export const LONG_NEVER: NeverLine = {
  id: 'n-long',
  line: 'pnpm --filter @acme/platform-api-and-background-workers exec prisma migrate reset --force --skip-seed --skip-generate',
}

/** What the engine refuses to add to the list, in its words. */
export function neverRefusal(line: string, lines: readonly NeverLine[]): string | undefined {
  if (line.trim() === '') return 'Write the command to refuse.'
  if (lines.some((one) => one.line === line.trim())) return `“${line.trim()}” is already refused.`
  return undefined
}

/**
 * The model of each role in Acme: two roles overridden, the others on the application's model.
 * Drawn on the picker's agents, so every model here is one the picker offers.
 */
export const ROLE_MODELS: readonly ProjectRoleModel[] = [
  {
    role: 'Planner',
    override: null,
    appDefault: { agent: 'claude', model: 'opus', effort: 'high' },
  },
  {
    role: 'Builder',
    override: { agent: 'codex', model: 'gpt-large', effort: 'medium' },
    appDefault: { agent: 'claude', model: 'sonnet' },
  },
  {
    role: 'Reviewer',
    override: null,
    appDefault: { agent: 'claude', model: 'sonnet', effort: 'high' },
  },
  {
    role: 'Probe',
    override: { agent: 'claude', model: 'haiku' },
    appDefault: { agent: 'claude', model: 'sonnet', effort: 'low' },
  },
  { role: 'Helper', override: null, appDefault: { agent: 'claude', model: 'haiku' } },
  { role: 'Setup agent', override: null, appDefault: { agent: 'claude', model: 'sonnet' } },
]

/** A long model name: a model of a long version behind a gateway. */
export const LONG_MODEL = 'acme-internal-gateway/qwen3-coder-480b-a35b-instruct'

const LONG_ROLE_MODEL: PickerModel = {
  id: 'qwen-long',
  name: LONG_MODEL,
  efforts: ['low', 'medium', 'high'],
}

/** The picker's agents with one model of a long name: what a self-hosted gateway can offer. */
export const LONG_ROLE_AGENTS: readonly PickerAgent[] = [
  ...AGENTS.filter((agent) => agent.id !== 'opencode'),
  { id: 'opencode', name: 'OpenCode', models: [LONG_ROLE_MODEL] },
]

/** The cap and the budget of a mission, each empty for the application's default. */
export const LIMITS: readonly BudgetLimit[] = [
  { id: 'cap', label: 'Sub-agents at once', value: null, fallback: 3 },
  { id: 'launches', label: 'Launches', value: '24', fallback: 20 },
  { id: 'retries', label: 'Automatic retries', value: null, fallback: 3 },
  { id: 'rounds', label: 'Automatic rounds', value: null, fallback: 5 },
]

/** What the engine refuses in a limit, in words: the cap is from 1 to 6. */
export function limitRefusal(id: string, value: string | null): string | undefined {
  if (value === null) return undefined
  if (id === 'cap') {
    return /^[1-6]$/.test(value.trim()) ? undefined : 'Write a whole number from 1 to 6.'
  }
  return /^[1-9]\d{0,2}$/.test(value.trim()) ? undefined : 'Write a whole number from 1 to 999.'
}

/** The instruction files found in each repository of Acme. */
export const INSTRUCTIONS: readonly RepositoryInstructions[] = [
  { repository: 'api', files: ['CLAUDE.md', 'AGENTS.md'] },
  { repository: 'web', files: ['AGENTS.md'] },
  { repository: 'shared', files: ['CLAUDE.md'] },
  { repository: 'billing', files: [] },
]

/** Which file each agent reads by itself; Hemera sends it the others. */
export const READERS: readonly AgentInstructions[] = [
  { agent: 'Claude Code', reads: ['CLAUDE.md'] },
  { agent: 'Codex', reads: ['AGENTS.md'] },
  { agent: 'OpenCode', reads: ['AGENTS.md', 'CLAUDE.md'] },
]
