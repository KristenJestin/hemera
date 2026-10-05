import type { PickerAgent } from './model-picker.tsx'

/**
 * The agents a story's picker is drawn on: two installed, with their models, efforts and modes,
 * one not installed. Names stay generic: the catalogue shows how a model is picked, not which.
 */
export const AGENTS: readonly PickerAgent[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    installed: true,
    modes: [
      { id: 'default', label: 'Default' },
      { id: 'plan', label: 'Plan' },
    ],
    models: [
      { id: 'opus', name: 'Opus', efforts: ['low', 'medium', 'high', 'max'], favourite: true },
      { id: 'sonnet', name: 'Sonnet', efforts: ['low', 'medium', 'high', 'max'], favourite: true },
      { id: 'haiku', name: 'Haiku' },
      { id: 'sonnet-1m', name: 'Sonnet (1M context)', efforts: ['low', 'medium', 'high'] },
      { id: 'opus-legacy', name: 'Opus (previous)', hidden: true },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    installed: true,
    modes: [
      { id: 'default', label: 'Default' },
      { id: 'read-only', label: 'Read only' },
    ],
    models: [
      { id: 'gpt-large', name: 'gpt-5', efforts: ['low', 'medium', 'high'] },
      { id: 'gpt-mini', name: 'gpt-5-mini', efforts: ['low', 'medium', 'high'] },
      { id: 'gpt-codex', name: 'gpt-5-codex', efforts: ['low', 'medium', 'high'], favourite: true },
    ],
  },
  { id: 'opencode', name: 'OpenCode', installed: false, install: 'npm install -g opencode-ai' },
]

/** A model with a long name, in an agent of its own: what a self-hosted model can be called. */
export const LONG_AGENTS: readonly PickerAgent[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    installed: true,
    modes: [{ id: 'default', label: 'Default' }],
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
