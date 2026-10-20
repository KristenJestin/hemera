/**
 * Gesture 5, an action on the remote that approves a deployment, which the single field of the
 * remote action (a workflow or a pipeline) cannot say. Two ways: Approve a deployment as a kind of
 * its own in the catalogue (recommended), or the action on the remote asking which action first.
 */
import { type ReactNode, useState } from 'react'

import { START_ITEMS } from '../../blocks/project-settings/delivery-form-options.ts'
import {
  Labelled,
  PlaceFields,
  type StepDraft,
} from '../../blocks/project-settings/delivery-forms.tsx'
import {
  CATALOGUE,
  type DeliveryRules,
  STEP_WORDS,
  type StepStart,
} from '../../blocks/project-settings/delivery-model.ts'
import { FormFoot } from '../../blocks/project-settings/parts.tsx'
import { Input, Textarea } from '../../components/field/field.tsx'
import { IconGitMerge } from '../../icons.ts'
import { SameEnd, SamePullRequests, SameWaves } from './frames.tsx'
import { GesturePage } from './gesture-page.tsx'

const nothing = (): void => {}

/** What the remote is asked: a workflow run, or a deployment approved. */
type RemoteWhat = 'run-workflow' | 'approve-deployment'

/** A kind of the catalogue, with Approve a deployment beside the others in the first variant. */
type Offered = (typeof CATALOGUE)[number] | 'approve-deployment'

function Fields({
  what,
  name,
  inputs,
  onName,
  onInputs,
}: {
  what: RemoteWhat
  name: string
  inputs: string
  onName: (next: string) => void
  onInputs: (next: string) => void
}): ReactNode {
  if (what === 'approve-deployment') {
    return (
      <Input
        label="Environment"
        placeholder="production"
        description="Hemera approves the deployment waiting on it, as you: your account must be one of its reviewers on GitHub."
        value={name}
        onValueChange={onName}
      />
    )
  }
  return (
    <>
      <Input label="Workflow" placeholder="release.yml" value={name} onValueChange={onName} />
      <Textarea
        label="Inputs"
        rows={2}
        description="One name=value a line."
        value={inputs}
        onValueChange={onInputs}
      />
    </>
  )
}

/** Where the new step goes in api's recipe, and how it starts. */
function Place({
  rules,
  draft,
  onChange,
}: {
  rules: DeliveryRules
  draft: StepDraft
  onChange: (next: StepDraft) => void
}): ReactNode {
  const api = rules.repositories.find((one) => one.path === 'api')
  return (
    <PlaceFields
      draft={draft}
      adding={{
        kinds: [],
        moments: true,
        after: (api?.steps ?? []).map((one) => ({
          id: one.step.id,
          label: STEP_WORDS[one.step.config.kind],
          moment: one.moment,
        })),
      }}
      onChange={onChange}
    />
  )
}

export type RemoteActionWay = 'own-kind' | 'action-first'

/**
 * The New step dialog of api (on GitHub), adding the approval of its production deployment.
 *
 * `own-kind`, recommended: Approve a deployment stands in the Kind list as its own step, beside
 * Action on the remote, which keeps its workflow (or pipeline) and gains its inputs. One choice,
 * one field, and the step's line says what it does: `Approve a deployment · production`. A forge
 * that cannot approve (Bitbucket) does not offer it.
 *
 * `action-first`: Action on the remote stays one kind, and asks which action first — Run a
 * workflow or Approve a deployment — then that action's fields. The catalogue keeps one entry;
 * the choice is made twice, and the line reads `Action on the remote · production`.
 */
export function NewRemoteStep({
  rules,
  way,
  initial,
}: {
  rules: DeliveryRules
  way: RemoteActionWay
  initial: RemoteWhat
}): ReactNode {
  const [kind, setKind] = useState<Offered>(
    way === 'own-kind' && initial === 'approve-deployment' ? 'approve-deployment' : 'remote-action',
  )
  const [what, setWhat] = useState<RemoteWhat>(initial)
  const [name, setName] = useState(initial === 'approve-deployment' ? 'production' : '')
  const [inputs, setInputs] = useState('')
  const [draft, setDraft] = useState<StepDraft>({
    start: 'click',
    config: { kind: 'remote-action', action: '' },
    moment: 'waves',
  })
  const offered: Offered[] =
    way === 'own-kind'
      ? CATALOGUE.flatMap((one): Offered[] =>
          one === 'remote-action' ? ['remote-action', 'approve-deployment'] : [one],
        )
      : [...CATALOGUE]
  const shown: RemoteWhat =
    way === 'own-kind'
      ? kind === 'approve-deployment'
        ? 'approve-deployment'
        : 'run-workflow'
      : what
  const form = {
    title: 'New step · api',
    icon: <IconGitMerge size="sm" />,
    body: (
      <>
        <Labelled<Offered>
          label="Kind"
          value={kind}
          onChange={setKind}
          items={offered.map((one) => ({
            value: one,
            label: one === 'approve-deployment' ? 'Approve a deployment' : STEP_WORDS[one],
          }))}
        />
        <Place rules={rules} draft={draft} onChange={setDraft} />
        {way === 'action-first' && (
          <Labelled<RemoteWhat>
            label="Action"
            value={what}
            onChange={setWhat}
            items={[
              { value: 'run-workflow', label: 'Run a workflow' },
              { value: 'approve-deployment', label: 'Approve a deployment' },
            ]}
          />
        )}
        <Fields what={shown} name={name} inputs={inputs} onName={setName} onInputs={setInputs} />
        <Labelled<StepStart>
          label="Starts"
          value={draft.start}
          onChange={(start) => setDraft({ ...draft, start })}
          items={START_ITEMS}
        />
      </>
    ),
    footer: <FormFoot save="Add" onSave={nothing} onCancel={nothing} />,
  }
  return (
    <GesturePage form={form}>
      <SamePullRequests rules={rules} />
      <SameWaves rules={rules} open={['api']} />
      <SameEnd rules={rules} />
    </GesturePage>
  )
}
