/**
 * The three declarations, each under its agent's name: a fourth agent in the domain is a compile
 * error here rather than a place someone forgets.
 */

import type { AgentProvider } from '@hemera/core/domain'

import type { AgentAdapter } from '../adapter.ts'
import { claude } from './claude.ts'
import { codex } from './codex.ts'
import { opencode } from './opencode.ts'

export const ADAPTERS: Readonly<Record<AgentProvider, AgentAdapter>> = { claude, codex, opencode }
