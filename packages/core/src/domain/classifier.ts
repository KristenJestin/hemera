/** The version recorded beside every Hemera Auto decision (D59-03). */
export const CLASSIFIER_POLICY_VERSION = '1'

export type ClassifierVerdict = 'allow' | 'ask' | 'deny'
export type LocalVerdict = 'allow' | 'deny' | 'defer'

/** A command after the runner has selected its platform line and resolved its invocation. */
export interface ResolvedCommand {
  readonly program: string
  readonly args: readonly string[]
  readonly shell: boolean
  readonly platform: string
}

/** Only a resolved, contained destination may earn a local allow. */
export interface LocalAction {
  readonly tool: string
  readonly target: 'inside' | 'outside' | 'unknown'
  readonly command?: ResolvedCommand
}

/**
 * Deliberately narrow: an unfamiliar call goes to the evaluator. This is not a shell parser;
 * the caller supplies the invocation the runner will execute, including whether it uses a shell.
 */
export function localClassifierVerdict(action: LocalAction): LocalVerdict {
  if (action.tool === 'commands_run') {
    const command = action.command
    if (command === undefined) return 'defer'
    const program = command.program.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase()
    if (
      program === 'rm' &&
      command.args.includes('-rf') &&
      command.args.some((arg) => arg === '.git' || arg === './.git')
    ) {
      return 'deny'
    }
    if (action.target !== 'inside' || command.shell) return 'defer'
    if (
      command.platform !== 'win32' &&
      (command.program === '/usr/bin/ls' || command.program === '/bin/ls') &&
      command.args.length === 0
    ) {
      return 'allow'
    }
    return 'defer'
  }

  if (action.target !== 'inside') return 'defer'
  switch (action.tool) {
    case 'fs_read':
    case 'fs_list':
    case 'commands_list':
    case 'commands_output':
    case 'project_get':
    case 'session_get':
    case 'spec_read':
    case 'build_read':
      return 'allow'
    default:
      return 'defer'
  }
}

/** The pinned Jev thresholds; all structural validation happens before calling this (D59-03). */
export function classifierVerdictFromScores(scores: {
  readonly risk: number
  readonly approval: number
  readonly userRequested: number
  readonly hasHumanContext: boolean
}): ClassifierVerdict {
  const { risk, approval, userRequested, hasHumanContext } = scores
  if (
    !Number.isFinite(risk) ||
    risk < 0 ||
    risk > 3 ||
    !Number.isFinite(approval) ||
    approval < 0 ||
    approval > 1 ||
    !Number.isFinite(userRequested) ||
    userRequested < 0 ||
    userRequested > 1
  ) {
    return 'ask'
  }
  if (risk >= 2.5) return 'deny'
  if (risk >= 1.5 || approval >= 0.75) {
    return hasHumanContext && userRequested >= 0.85 ? 'allow' : 'ask'
  }
  return 'allow'
}
