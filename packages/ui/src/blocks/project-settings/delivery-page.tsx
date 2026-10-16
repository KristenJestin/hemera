/**
 * A page of a Project's settings around its delivery rules, holding what the renderer will hold:
 * the stories of the section and the explorations of its open questions are drawn in it.
 */
import { type ReactNode, useState } from 'react'

import { IconBook2, IconChecklist, IconGitMerge } from '../../icons.ts'
import { ProjectSettings } from '../../surfaces/project-settings/project-settings.tsx'
import { SECTIONS } from '../../surfaces/project-settings/settings-sections.tsx'
import { dialogFor } from './delivery-dialogs.tsx'
import { type Drafts, seed } from './delivery-drafts.ts'
import { withAccepted, withoutCleanup, withPreset, withPutBack } from './delivery-edits.ts'
import type { DeliveryRefusals, DeliveryRules, PullRequestRules } from './delivery-model.ts'
import { DeliveryRulesSection, type DeliveryTarget } from './delivery-rules.tsx'
import { FormFoot, type FormFootProps } from './parts.tsx'

export interface DeliveryPageProps {
  /** The Project's name: Acme unless said otherwise. */
  name?: string | undefined
  mainCheckout?: string | undefined
  /** Null: the rules are on their way. */
  rules: DeliveryRules | null
  refusals?: DeliveryRefusals | undefined
  error?: string | undefined
  /** The repositories unfolded at first. */
  open?: readonly string[] | undefined
  /** The dialog open at first. */
  form?: DeliveryTarget | undefined
  /** Why every save is refused, in words, as one meeting a newer version is. */
  refused?: string | undefined
  onSave: (what: string) => void
  onCopy: (line: string) => void
  onCheckAgain: (repository: string) => void
}

/** A page of Acme's settings around the delivery rules, holding what the renderer will hold. */
export function DeliveryPage(props: DeliveryPageProps): ReactNode {
  const [rules, setRules] = useState(props.rules)
  const [given, setGiven] = useState(props.rules)
  if (given !== props.rules) {
    setGiven(props.rules)
    setRules(props.rules)
  }
  const [form, setForm] = useState<DeliveryTarget | null>(props.form ?? null)
  const [drafts, setDrafts] = useState<Drafts>(() => seed(props.form ?? null, props.rules))
  const draft = <Key extends keyof Drafts>(key: Key) => {
    return (next: Drafts[Key]): void => setDrafts((before) => ({ ...before, [key]: next }))
  }
  const [checking, setChecking] = useState<string[]>([])
  const pr = rules?.pullRequests
  const open = (target: DeliveryTarget | null): void => {
    setDrafts(seed(target, rules))
    setForm(target)
  }
  const close = (): void => setForm(null)
  const edit = (change: (before: DeliveryRules) => DeliveryRules): void =>
    setRules((before) => (before === null ? before : change(before)))
  const setPullRequests = (part: Partial<PullRequestRules>): void =>
    edit((before) => ({ ...before, pullRequests: { ...before.pullRequests, ...part } }))
  const save = (what: string, apply: () => void, refusal?: string): void => {
    props.onSave(what)
    if (props.refused !== undefined || refusal !== undefined) return
    apply()
    close()
  }
  const foot = (
    what: string,
    apply: () => void,
    refusal?: string,
    extra?: Partial<FormFootProps>,
  ) => (
    <FormFoot
      refused={props.refused}
      onSave={() => save(what, apply, refusal)}
      onCancel={close}
      {...extra}
    />
  )
  const dialog =
    form !== null && rules !== null && pr !== undefined
      ? dialogFor(form, {
          rules,
          drafts,
          foot,
          onTemplate: draft('template'),
          onPush: draft('push'),
          onReviewers: draft('reviewers'),
          onRepository: draft('repository'),
          onStep: draft('step'),
          onClose: close,
          setPullRequests,
          edit,
        })
      : null
  return (
    <main className="flex h-screen flex-col bg-surface-content">
      <ProjectSettings
        name={props.name ?? 'Acme'}
        mainCheckout={props.mainCheckout ?? '~/work/acme'}
        sections={[
          ...SECTIONS,
          { id: 'checks', label: 'Checks', icon: <IconChecklist size="sm" /> },
          { id: 'documentation', label: 'Documentation', icon: <IconBook2 size="sm" /> },
          {
            id: 'delivery',
            label: 'Delivery rules',
            icon: <IconGitMerge size="sm" />,
            problem:
              props.refusals !== undefined ||
              rules?.repositories.some((one) => one.steps.some((s) => s.refused !== undefined))
                ? 'rules refused'
                : undefined,
          },
        ]}
        current="delivery"
        onSection={() => {}}
        onRetry={() => {}}
        form={dialog}
        onCloseForm={close}
      >
        <DeliveryRulesSection
          rules={rules}
          refusals={props.refusals}
          error={props.error}
          initiallyOpen={props.open}
          checking={checking}
          onOpen={open}
          onToggle={(rule, on) => setPullRequests({ [rule]: on })}
          onPreset={(path, preset) => edit((before) => withPreset(before, path, preset))}
          onPutBack={(path, id) => edit((before) => withPutBack(before, path, id))}
          onReset={() => {}}
          onAcceptDependency={(dependency) => edit((before) => withAccepted(before, dependency))}
          onRemoveCleanup={(id) => edit((before) => withoutCleanup(before, id))}
          onCheckAgain={(path) => {
            props.onCheckAgain(path)
            setChecking((before) => [...before, path])
          }}
          onCopy={props.onCopy}
        />
      </ProjectSettings>
    </main>
  )
}
