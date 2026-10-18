/**
 * Gesture 4, removing an accepted dependency between repositories. Two places: the accepted ones
 * listed under the waves, each with Remove, above the proposed ones and their Accept
 * (recommended); or what a repository delivers after, ticked in its own dialog.
 */
import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { wavesOf } from '../../blocks/project-settings/delivery-fixtures.ts'
import {
  RepositoryForm,
  type RepositoryDraft,
} from '../../blocks/project-settings/delivery-forms.tsx'
import type { Dependency, DeliveryRules } from '../../blocks/project-settings/delivery-model.ts'
import {
  CELLS,
  FRAME_BAND,
  GLYPH,
  ITEM,
  ProposedDependency,
  QUIET_BAND,
  RepositoryRow,
  upstreamOf,
} from '../../blocks/project-settings/delivery-rules.tsx'
import { FormFoot } from '../../blocks/project-settings/parts.tsx'
import { IconButton } from '../../components/button/button.tsx'
import { Checkbox } from '../../components/checkbox/checkbox.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconGitMerge, IconPackage, IconX } from '../../icons.ts'
import { SameEnd, SamePullRequests, SameWaves } from './frames.tsx'
import { GesturePage } from './gesture-page.tsx'

const nothing = (): void => {}

const SUB_BAND =
  'flex h-control-sm items-center border-b border-border px-4 text-xs text-muted-foreground'

/** The rules with these dependencies, and the waves they give. */
function withDependencies(
  rules: DeliveryRules,
  dependencies: readonly Dependency[],
): DeliveryRules {
  return {
    ...rules,
    dependencies,
    waves:
      wavesOf(
        rules.repositories.map((one) => one.path),
        dependencies,
      ) ?? [],
  }
}

const same = (a: Dependency, b: Dependency): boolean =>
  a.repository === b.repository && a.on === b.on

function AcceptedDependency({
  dependency,
  onRemove,
}: {
  dependency: Dependency
  onRemove: () => void
}): ReactNode {
  const words = `${dependency.repository} delivers after ${dependency.on}`
  return (
    <li className={ITEM}>
      <div className={cn(CELLS, 'pr-2')}>
        <span className={GLYPH} aria-hidden="true">
          <IconPackage size="sm" />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-mono">{dependency.repository}</span>{' '}
          <span className="text-muted-foreground">delivers after</span>{' '}
          <span className="font-mono">{dependency.on}</span>
        </span>
        <Tooltip label="Remove">
          <IconButton
            size="sm"
            variant="ghost"
            icon={<IconX size="sm" />}
            aria-label={`Remove: ${words}`}
            onClick={onRemove}
          />
        </Tooltip>
      </div>
    </li>
  )
}

/**
 * Recommended: the accepted dependencies stand under the waves, one line each, with Remove; the
 * proposed ones follow as they do today, with Accept. One place says why the waves are in this
 * order, and changes it both ways. A removed dependency the manifests still name goes back to
 * the proposed ones, so it can be accepted again.
 */
export function ListedUnderTheWaves({
  rules: initial,
  manifests,
}: {
  rules: DeliveryRules
  /** The dependencies Hemera reads in the manifests: removed, they are proposed again. */
  manifests: readonly Dependency[]
}): ReactNode {
  const [rules, setRules] = useState(initial)
  const byPath = new Map(rules.repositories.map((one) => [one.path, one]))
  const accepted = rules.dependencies.filter((one) => !one.proposed)
  const proposed = rules.dependencies.filter((one) => one.proposed)
  const remove = (dependency: Dependency): void => {
    const read = manifests.some((one) => same(one, dependency))
    setRules(
      withDependencies(
        rules,
        rules.dependencies.flatMap((one) =>
          same(one, dependency) ? (read ? [{ ...one, proposed: true }] : []) : [one],
        ),
      ),
    )
  }
  const accept = (dependency: Dependency): void =>
    setRules(
      withDependencies(
        rules,
        rules.dependencies.map((one) =>
          same(one, dependency) ? { ...one, proposed: false } : one,
        ),
      ),
    )
  return (
    <GesturePage>
      <SamePullRequests rules={rules} />
      <Frame>
        <h3 className={FRAME_BAND}>
          Waves <span className={QUIET_BAND}>· after Ship</span>
        </h3>
        {rules.waves.map((paths, index) => {
          const label = `Wave ${String(index + 1)}`
          return (
            <div key={label} className="flex flex-col border-b border-border">
              <h4 className={SUB_BAND}>{label}</h4>
              <ul aria-label={label} className="flex flex-col">
                {paths.map((path) => {
                  const repository = byPath.get(path)
                  if (repository === undefined) return null
                  return (
                    <RepositoryRow
                      key={path}
                      repository={repository}
                      after={upstreamOf(path, rules.dependencies)}
                      checking={false}
                      onOpen={nothing}
                      onPreset={nothing}
                      onPutBack={nothing}
                      onReset={nothing}
                      onCheckAgain={nothing}
                      onCopy={nothing}
                    />
                  )
                })}
              </ul>
            </div>
          )
        })}
        <h4 className={SUB_BAND}>Delivers after</h4>
        <ul aria-label="Dependencies" className="flex flex-col border-b border-border">
          {accepted.map((one) => (
            <AcceptedDependency
              key={`${one.repository}>${one.on}`}
              dependency={one}
              onRemove={() => remove(one)}
            />
          ))}
          {accepted.length === 0 && (
            <li className="py-2 pr-4 pl-4 text-sm text-muted-foreground">
              None: every repository delivers in the first wave.
            </li>
          )}
        </ul>
        {proposed.length > 0 && (
          <>
            <h4 className={SUB_BAND}>Hemera read these in the manifests</h4>
            <ul aria-label="Proposed dependencies" className="flex flex-col">
              {proposed.map((one) => (
                <ProposedDependency
                  key={`${one.repository}>${one.on}`}
                  dependency={one}
                  onAccept={() => accept(one)}
                />
              ))}
            </ul>
          </>
        )}
      </Frame>
      <SameEnd rules={rules} />
    </GesturePage>
  )
}

/**
 * The alternative: a repository's dialog (its remote, base and forge) also says what it delivers
 * after, one box per other repository; a proposed one is there unticked, said read in the
 * manifests. The waves keep only the proposed ones' Accept; nothing else of the order is on the
 * page.
 */
export function TickedInItsDialog({
  rules,
  repository: path,
}: {
  rules: DeliveryRules
  repository: string
}): ReactNode {
  const found = rules.repositories.find((one) => one.path === path)
  const [draft, setDraft] = useState<RepositoryDraft>({
    remote: found?.remote ?? 'origin',
    base: found?.base ?? 'main',
    forced: null,
    host: '',
  })
  const [after, setAfter] = useState(() => new Set(upstreamOf(path, rules.dependencies)))
  const others = rules.repositories.filter((one) => one.path !== path)
  const proposed = new Set(
    rules.dependencies
      .filter((one) => one.proposed && one.repository === path)
      .map((one) => one.on),
  )
  const form = {
    title: path,
    icon: <IconGitMerge size="sm" />,
    body: (
      <>
        <RepositoryForm
          draft={draft}
          remotes={found?.remotes ?? ['origin']}
          detected={found?.forge.kind ?? 'github'}
          refusals={{}}
          onChange={setDraft}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-sm font-medium">Delivers after</legend>
          {others.map((one) => (
            <Checkbox
              key={one.path}
              checked={after.has(one.path)}
              onCheckedChange={(on) => {
                const next = new Set(after)
                if (on) next.add(one.path)
                else next.delete(one.path)
                setAfter(next)
              }}
              label={<span className="font-mono">{one.path}</span>}
              description={proposed.has(one.path) ? 'Hemera read it in the manifests' : undefined}
            />
          ))}
        </fieldset>
      </>
    ),
    footer: <FormFoot onSave={nothing} onCancel={nothing} />,
  }
  return (
    <GesturePage form={form}>
      <SamePullRequests rules={rules} />
      <SameWaves rules={rules} />
      <SameEnd rules={rules} />
    </GesturePage>
  )
}
