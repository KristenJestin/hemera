import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { IconBrandHemeraAuto } from '../icons.ts'
import { PermissionRequest } from './permission-request.tsx'

export type ClassifierDecisionState =
  | 'evaluating'
  | 'allowed'
  | 'ask'
  | 'denied'
  | 'unavailable'
  | 'cancelled'

export interface ClassifierDecisionProps {
  state: ClassifierDecisionState
  call: string
  target: string
  reason: string
  by?: 'rules' | 'judge' | 'user' | undefined
  policyVersion?: string | undefined
  model?: string | undefined
  scores?: string | undefined
  onDecide?: ((answer: 'allow' | 'reject') => void) | undefined
}

const LABEL: Record<ClassifierDecisionState, string> = {
  evaluating: 'Evaluating',
  allowed: 'Allowed automatically',
  ask: 'Needs your confirmation',
  denied: 'Refused',
  unavailable: 'Evaluator unavailable',
  cancelled: 'Cancelled',
}

const TONE: Record<
  ClassifierDecisionState,
  'info' | 'success' | 'warning' | 'destructive' | 'neutral'
> = {
  evaluating: 'info',
  allowed: 'success',
  ask: 'warning',
  denied: 'destructive',
  unavailable: 'warning',
  cancelled: 'neutral',
}

/** A classifier verdict in the thread; execution keeps its own, separate outcome. */
export function ClassifierDecision({
  state,
  call,
  target,
  reason,
  by,
  policyVersion,
  model,
  scores,
  onDecide,
}: ClassifierDecisionProps): ReactNode {
  return (
    <section
      aria-label={`Hemera Auto decision for ${call}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <IconBrandHemeraAuto size="sm" aria-hidden="true" />
        <span className="font-medium">Hemera Auto</span>
        {state === 'evaluating' && <Loading size="sm" label="Evaluating this call" />}
        <Badge tone={TONE[state]}>
          {state === 'allowed' && by === 'user' ? 'Allowed by you' : LABEL[state]}
        </Badge>
      </div>
      <p className="font-mono text-xs text-foreground">
        {call} · {target}
      </p>
      <p className="text-sm text-muted-foreground">{reason}</p>
      {(by !== undefined ||
        policyVersion !== undefined ||
        model !== undefined ||
        scores !== undefined) && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {by !== undefined && (
            <div className="flex gap-1">
              <dt>Decided by</dt>
              <dd>{by}</dd>
            </div>
          )}
          {policyVersion !== undefined && (
            <div className="flex gap-1">
              <dt>Policy</dt>
              <dd>{policyVersion}</dd>
            </div>
          )}
          {model !== undefined && (
            <div className="flex gap-1">
              <dt>Model</dt>
              <dd>{model}</dd>
            </div>
          )}
          {scores !== undefined && (
            <div className="flex gap-1">
              <dt>Scores</dt>
              <dd>{scores}</dd>
            </div>
          )}
        </dl>
      )}
      {(state === 'ask' || state === 'unavailable') && onDecide !== undefined && (
        <PermissionRequest
          toolName={call}
          label={call}
          subject={target}
          intent="asks for this call only"
          command={target}
          options={[
            { optionId: 'reject', kind: 'reject_once', name: 'Refuse' },
            { optionId: 'allow', kind: 'allow_once', name: 'Allow once' },
          ]}
          onDecide={(option) => onDecide(option.optionId === 'allow' ? 'allow' : 'reject')}
        />
      )}
    </section>
  )
}
