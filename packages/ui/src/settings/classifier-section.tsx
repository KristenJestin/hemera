import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { AnimatePresence, LayoutGroup, motion } from 'motion/react'
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Card } from '../components/card/card.tsx'
import { Checkbox } from '../components/checkbox/checkbox.tsx'
import { Input } from '../components/field/field.tsx'
import { IconBrandHemeraAuto, IconBrandTypeSafe, IconRobot } from '../icons.ts'
import { arrival, collapse, expand, fold, useTransition } from '../motion.ts'

export type ClassifierMode = 'agent-default' | 'hemera-auto'
export type CredentialStatus = 'missing' | 'saved' | 'invalid' | 'storage-unavailable'
export type EvaluatorStatus = 'ready' | 'unavailable' | 'transitioning'

export interface ClassifierOption {
  id: ClassifierMode
  label: string
  description: string
  available: boolean
}

export interface EvaluationEngineOption {
  id: string
  label: string
  provider: string
  description: string
  available: boolean
}

export const CLASSIFIER_OPTIONS: readonly ClassifierOption[] = [
  {
    id: 'agent-default',
    label: 'Agent default',
    description:
      'Use the selected agent’s available permission behavior. Hemera’s own guards still apply.',
    available: true,
  },
  {
    id: 'hemera-auto',
    label: 'Hemera Auto',
    description:
      'One shared permission policy for calls to Hemera’s tools across all Projects and Sessions.',
    available: true,
  },
]

export const EVALUATION_ENGINES: readonly EvaluationEngineOption[] = [
  {
    id: 'jev',
    label: 'Jev',
    provider: 'TypeSafe AI',
    description: 'Evaluates actions that Hemera’s local rules cannot settle.',
    available: true,
  },
]

export interface ClassifierSectionProps {
  mode: ClassifierMode
  onModeChange: (mode: ClassifierMode) => void
  options?: readonly ClassifierOption[] | undefined
  engine: string
  onEngineChange: (engine: string) => void
  engines?: readonly EvaluationEngineOption[] | undefined
  credential: CredentialStatus
  credentialMessage?: string | undefined
  evaluator: EvaluatorStatus
  consent: boolean
  onConsentChange: (consent: boolean) => void
  onSaveKey: (key: string) => void
  onRemoveKey: () => void
}

const OPTION =
  'focus-ring relative z-10 flex w-full items-start gap-3 rounded-md px-3 py-3 text-left text-sm text-foreground hover:text-primary-muted-foreground'
const SLOT = 'relative flex rounded-md border border-border bg-muted'
const SELECTED = 'absolute inset-0 rounded-md border border-primary bg-primary-muted'
const NOTE = 'text-sm text-muted-foreground'

function statusOf(
  credential: CredentialStatus,
  evaluator: EvaluatorStatus,
  consent: boolean,
): ReactNode {
  if (evaluator === 'transitioning') return <Badge tone="info">Changing across Sessions…</Badge>
  if (evaluator === 'unavailable') return <Badge tone="warning">Evaluator unavailable</Badge>
  if (credential === 'storage-unavailable')
    return <Badge tone="destructive">Protected storage unavailable</Badge>
  if (credential === 'invalid') return <Badge tone="warning">Key rejected</Badge>
  if (credential === 'missing') return <Badge tone="warning">Key required</Badge>
  if (!consent) return <Badge tone="warning">Consent required</Badge>
  return <Badge tone="success">Ready</Badge>
}

/** The application's one permission choice, followed by the selected engine's local settings. */
export function ClassifierSection({
  mode,
  onModeChange,
  options = CLASSIFIER_OPTIONS,
  engine,
  onEngineChange,
  engines = EVALUATION_ENGINES,
  credential,
  credentialMessage,
  evaluator,
  consent,
  onConsentChange,
  onSaveKey,
  onRemoveKey,
}: ClassifierSectionProps): ReactNode {
  const [key, setKey] = useState('')
  const keyField = useRef<HTMLInputElement>(null)
  const restoreKeyFocus = useRef(false)
  const transition = useTransition(arrival)
  const folding = useTransition(fold)
  const classifierGroup = useId()
  const engineGroup = useId()

  useEffect(() => {
    if (credential === 'missing' && restoreKeyFocus.current) {
      keyField.current?.focus()
      restoreKeyFocus.current = false
    }
  }, [credential])

  function save(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (key.trim() === '') return
    onSaveKey(key.trim())
    setKey('')
  }

  return (
    <Card
      title="Permission classifier"
      description="One application choice on this machine, shared by every Project and Session."
    >
      <div>
        <RadioGroup
          aria-label="Permission classifier"
          className="flex flex-col gap-2"
          value={mode}
          onValueChange={(next) => {
            if (next === 'agent-default' || next === 'hemera-auto') onModeChange(next)
          }}
        >
          <LayoutGroup id={classifierGroup}>
            {options.map((option) => (
              <span key={option.id} className={SLOT}>
                {option.id === mode && (
                  <motion.span
                    layoutId={`${classifierGroup}-selected`}
                    className={SELECTED}
                    transition={transition}
                  />
                )}
                <Radio.Root
                  value={option.id}
                  nativeButton
                  render={<button type="button" />}
                  disabled={!option.available || evaluator === 'transitioning'}
                  className={OPTION}
                >
                  {option.id === 'hemera-auto' ? (
                    <IconBrandHemeraAuto size="md" />
                  ) : (
                    <IconRobot size="md" />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium">{option.label}</span>
                    <span className={NOTE}>{option.description}</span>
                  </span>
                  {!option.available && <Badge tone="neutral">Unavailable</Badge>}
                </Radio.Root>
              </span>
            ))}
          </LayoutGroup>
        </RadioGroup>

        <div inert={mode !== 'hemera-auto'}>
          <AnimatePresence initial={false}>
            {mode === 'hemera-auto' && (
              <motion.div
                className="overflow-hidden"
                initial={collapse}
                animate={expand}
                exit={collapse}
                transition={folding}
              >
                <div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
                  <div role="status" className="flex flex-wrap items-center gap-2">
                    <IconBrandHemeraAuto size="sm" aria-hidden="true" />
                    <p className="min-w-0 flex-1 text-sm font-medium">Hemera Auto</p>
                    {statusOf(credential, evaluator, consent)}
                  </div>
                  <p className={NOTE}>
                    Local rules settle clear cases. Other calls are evaluated by the engine below.
                    If it cannot evaluate a call, Hemera asks you. Calls outside Hemera’s tools keep
                    their own permission path.
                  </p>
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Evaluation engine</p>
                    <RadioGroup
                      aria-label="Evaluation engine"
                      className="flex flex-col gap-2"
                      value={engine}
                      onValueChange={onEngineChange}
                    >
                      <LayoutGroup id={engineGroup}>
                        {engines.map((option) => (
                          <span key={option.id} className={SLOT}>
                            {option.id === engine && (
                              <motion.span
                                layoutId={`${engineGroup}-selected`}
                                className={SELECTED}
                                transition={transition}
                              />
                            )}
                            <Radio.Root
                              value={option.id}
                              nativeButton
                              render={<button type="button" />}
                              disabled={!option.available || evaluator === 'transitioning'}
                              className={OPTION}
                            >
                              {option.id === 'jev' && <IconBrandTypeSafe size="md" />}
                              <span className="flex min-w-0 flex-1 flex-col gap-1">
                                <span className="font-medium">
                                  {option.label} · by {option.provider}
                                </span>
                                <span className={NOTE}>{option.description}</span>
                              </span>
                              {!option.available && <Badge tone="neutral">Unavailable</Badge>}
                            </Radio.Root>
                          </span>
                        ))}
                      </LayoutGroup>
                    </RadioGroup>
                  </div>

                  {engine === 'jev' && (
                    <div className="flex flex-col gap-3">
                      <form className="flex flex-wrap gap-2" onSubmit={save}>
                        <Input
                          className="min-w-0 flex-1"
                          label="Jev API key"
                          labelTrailing={
                            credential === 'saved' ? <Badge tone="success">Saved</Badge> : undefined
                          }
                          inputRef={keyField}
                          type="password"
                          name="jev-api-key"
                          autoComplete="off"
                          value={key}
                          onValueChange={setKey}
                          disabled={
                            credential === 'storage-unavailable' || evaluator === 'transitioning'
                          }
                          placeholder={
                            credential === 'saved' ? 'Replace saved key' : 'Enter Jev API key'
                          }
                          action={
                            <span className="flex gap-2">
                              <Button
                                type="submit"
                                size="sm"
                                disabled={
                                  key.trim() === '' ||
                                  credential === 'storage-unavailable' ||
                                  evaluator === 'transitioning'
                                }
                              >
                                {credential === 'saved' ? 'Replace key' : 'Save key'}
                              </Button>
                              {credential !== 'missing' && credential !== 'storage-unavailable' && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    restoreKeyFocus.current = true
                                    onRemoveKey()
                                  }}
                                >
                                  Remove key
                                </Button>
                              )}
                            </span>
                          }
                        />
                      </form>
                      {credentialMessage !== undefined && (
                        <p role="alert" className="text-sm text-destructive-muted-foreground">
                          {credentialMessage}
                        </p>
                      )}
                      <p className={NOTE}>
                        The key is encrypted with this machine’s protected storage and kept in
                        Hemera’s Profile. It is never shown again. Saving it does not change the
                        classifier choice.
                      </p>
                      <div className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3 text-sm">
                        <p className="font-medium">Data sent to TypeSafe AI</p>
                        <p className={NOTE}>
                          Jev receives the action, its resolved target and a bounded selection of
                          this Session’s recent human requests. In a build, the frozen Spec can be
                          included as separately labelled user intent. Known secrets and credential
                          fields are masked; arbitrary secrets cannot always be recognized. Raw tool
                          results are not sent.
                        </p>
                        <Checkbox
                          checked={consent}
                          onCheckedChange={onConsentChange}
                          label="Allow this evaluation data to be sent to TypeSafe AI."
                        />
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Card>
  )
}
