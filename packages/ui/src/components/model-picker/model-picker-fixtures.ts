import type { PickerAgent } from './model-picker.tsx'

/**
 * The agents a story's picker is drawn on: the three this machine has, with their models and
 * efforts. Names stay generic: the catalogue shows how a model is picked, not which.
 */
export const AGENTS: readonly PickerAgent[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    models: [
      {
        id: 'opus',
        name: 'Opus',
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'high',
        favourite: true,
      },
      {
        id: 'sonnet',
        name: 'Sonnet',
        efforts: ['low', 'medium', 'high', 'max'],
        defaultEffort: 'medium',
        favourite: true,
      },
      { id: 'haiku', name: 'Haiku' },
      { id: 'sonnet-1m', name: 'Sonnet (1M context)', efforts: ['low', 'medium', 'high'] },
      { id: 'opus-legacy', name: 'Opus (previous)', hidden: true },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    models: [
      {
        id: 'gpt-large',
        defaultEffort: 'medium',
        name: 'gpt-5',
        efforts: ['low', 'medium', 'high'],
      },
      {
        id: 'gpt-mini',
        defaultEffort: 'medium',
        name: 'gpt-5-mini',
        efforts: ['low', 'medium', 'high'],
      },
      {
        id: 'gpt-codex',
        defaultEffort: 'medium',
        name: 'gpt-5-codex',
        efforts: ['low', 'medium', 'high'],
        favourite: true,
      },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    models: [
      { id: 'big-pickle', name: 'big-pickle' },
      { id: 'grok-code', name: 'grok-code-fast' },
    ],
  },
]

/** A model with a long name and a long list: what a self-hosted catalogue can look like. */
export const LONG_AGENTS: readonly PickerAgent[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    models: [
      {
        id: 'long',
        name: 'acme-internal-reasoning-model-2026-10-preview-with-extended-context',
        efforts: ['low', 'medium', 'high'],
      },
      ...Array.from({ length: 14 }, (_, at) => ({
        id: `model-${String(at)}`,
        name: `Model ${String(at + 1)}`,
      })),
    ],
  },
]

const [CLAUDE, CODEX, OPENCODE] = AGENTS

/** Codex is installed but not signed in. */
export const AGENTS_SIGNED_OUT: readonly PickerAgent[] = [
  ...(CLAUDE === undefined ? [] : [CLAUDE]),
  ...(CODEX === undefined ? [] : [{ ...CODEX, unavailable: 'Not signed in' }]),
  ...(OPENCODE === undefined ? [] : [OPENCODE]),
]

/** Every agent's models still on their way. */
export const AGENTS_LOADING: readonly PickerAgent[] = AGENTS.map(({ id, name }) => ({
  id,
  name,
  models: [],
  loading: true,
}))

/** Claude Code could not list its models. */
export const AGENTS_FAILED: readonly PickerAgent[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    models: [],
    error: 'Claude Code did not list its models in time.',
  },
  ...AGENTS.filter((agent) => agent.id !== 'claude'),
]
