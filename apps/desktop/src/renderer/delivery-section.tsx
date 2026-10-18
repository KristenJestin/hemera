/**
 * The Delivery rules section of a Project's settings (#465), as #250 drew it, on the engine's
 * rules (#340, #429) and forges (#253). Each change, from a dialog or a line, is checked by the
 * engine first (`deliveryRules.validate`): a change it refuses stays shown, every reason at its
 * place, until it is mended; one it accepts is saved at once, on the version it was edited from.
 * A forge's command line in trouble says its fixing command and Check again. No Effect here.
 */

import type { DeliveryProject, DeliveryRulesDraft } from '@hemera/core/domain'
import type { Command, DeliveryRulesView, ForgeRepositoryStatus, Project } from '@hemera/ipc'
import { DeliveryRulesSection, type DeliveryTarget, type SettingsForm } from '@hemera/ui'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { type DialogContext, deliveryDialogOf, forcedOf } from './delivery-dialogs.tsx'
import {
  actionIn,
  actionOf,
  deliveryProjectOf,
  shownOf,
  withCleanupAdded,
  withCleanupRemoved,
  withCleanupSaved,
  withPreparation,
  withPreset,
  withPushIn,
  withReviewDrafts,
  withStepAdded,
  withStepPutBack,
  withStepRemoved,
  withStepReset,
  withStepSaved,
  withTemplate,
  workingOf,
  writeRules,
  type DeliveryShown,
  type Working,
} from './delivery-settings-model.ts'
import type { Link } from './link.ts'
import { sentenceOf } from './settings-refusals.ts'
import { type Read } from './app-settings-data.ts'
import { useRead, valueOf } from './use-read.tsx'

export interface DeliveryPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  project: Project | null
  catalogue: ReadonlyArray<Command>
  /** Shows a dialog over the page, or closes it with null. */
  show: (form: SettingsForm | null) => void
  copy: (text: string) => void
  /**
   * Opened by a link, a need's about a forge's command line: the repositories whose command line
   * is in trouble are unfolded.
   */
  linked: boolean
  /** What is wrong in the section, for its glyph in the list; undefined when nothing is. */
  onProblem: (problem: string | undefined) => void
}

/** The forges of the Project, read while the section is shown and followed as they change. */
function useForges(
  link: Link,
  engineReady: boolean,
  projectId: string,
): [
  ReadonlyArray<ForgeRepositoryStatus> | null,
  (next: ReadonlyArray<ForgeRepositoryStatus>) => void,
] {
  const [forges, setForges] = useState<ReadonlyArray<ForgeRepositoryStatus> | null>(null)
  useEffect(() => {
    if (!engineReady) return undefined
    let live = true
    link.forgeStatus(projectId).then(
      (statuses) => {
        if (live) setForges(statuses)
      },
      () => undefined,
    )
    const stop = link.onForgeChanges(
      projectId,
      (statuses) => setForges(statuses),
      () => undefined,
    )
    return () => {
      live = false
      stop()
    }
  }, [link, engineReady, projectId])
  return [forges, setForges]
}

/** What a change is: the rules before it, and the rules after. */
type Change = (draft: DeliveryRulesDraft) => DeliveryRulesDraft

/** The rules read, the change being edited, and how a change is written. */
interface Rules {
  readonly view: Read<DeliveryRulesView>
  readonly working: Working | null
  /** Checks a change, keeps it with its reasons when refused, saves it otherwise. */
  readonly commit: (change: Change) => Promise<void>
  readonly setView: (view: DeliveryRulesView) => void
}

/**
 * The Project's rules while the section is shown: read, checked by the engine as they are read (a
 * forge that changed can make saved rules stop holding), and changed one change at a time. What
 * is wrong is said to the page as it is learned, for the section's glyph in the list.
 */
function useRules(
  link: Link,
  engineReady: boolean,
  projectId: string,
  forges: ReadonlyArray<ForgeRepositoryStatus> | null,
  onProblem: (problem: string | undefined) => void,
): Rules {
  const read = useCallback((on: Link) => on.deliveryRules(projectId), [projectId])
  const [view, setView] = useRead(link, engineReady, read)
  const saved = valueOf(view)
  const [working, setWorking] = useState<Working | null>(null)
  const [seeded, setSeeded] = useState(saved)
  if (saved !== seeded) {
    setSeeded(saved)
    setWorking(saved === null ? null : workingOf(saved))
  }
  /** The change being edited, as the last render drew it, for the answers that come later. */
  const drawn = useRef(working)
  useEffect(() => {
    drawn.current = working
  })
  useEffect(() => {
    if (saved === null) return undefined
    let live = true
    const start = workingOf(saved)
    // react-doctor-disable-next-line no-pass-live-state-to-parent -- the engine's answer about the rules read, for the section's glyph in the list
    link.validateDeliveryRules(projectId, start.draft).then(
      (problems) => {
        const before = drawn.current
        // A change made meanwhile has its own reasons: the rules read no longer stand.
        if (!live || before === null || before.edited || before.version !== start.version) return
        setWorking({ ...start, problems })
        onProblem(problems.length > 0 ? 'rules refused' : undefined)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [link, projectId, saved, forges, onProblem])
  // A section left forgets the change it held: nothing is wrong in it any more.
  useEffect(() => () => onProblem(undefined), [onProblem])
  const commit = (change: Change): Promise<void> => {
    if (working === null) return Promise.resolve()
    return writeRules(link, projectId, working, change(working.draft)).then((written) => {
      if (written.kind === 'saved') {
        setView(written.view)
        return
      }
      setWorking(written.working)
      onProblem(written.working.problems.length > 0 ? 'rules refused' : undefined)
    })
  }
  return { view, working, commit, setView }
}

/**
 * A repository's remote, base branch and forge written: each only when it changed, the Project's
 * version carried from one write to the next. Answers the forges when the forge was written.
 */
async function writeRepository(
  link: Link,
  project: Project,
  forges: ReadonlyArray<ForgeRepositoryStatus> | null,
  repositoryId: string,
  chosen: Parameters<DialogContext['edit']['repository']>[1],
): Promise<ReadonlyArray<ForgeRepositoryStatus> | null> {
  const repository = project.repositories.find((one) => one.id === repositoryId)
  if (repository === undefined) return null
  let { version } = project
  const remote = chosen.remote === '' ? null : chosen.remote
  if (remote !== repository.remote) {
    const changed = await link.setRemote({ id: repositoryId, version, remote })
    version = changed.version
  }
  if (chosen.base !== repository.baseBranch) {
    await link.setBaseBranch({ id: repositoryId, version, branch: chosen.base })
  }
  const status = forges?.find((one) => one.repositoryId === repositoryId)
  const forced = forcedOf(chosen)
  const host = forced === 'bitbucket-datacenter' ? chosen.host.trim() : null
  const was = status?.forced === true ? status.forge : null
  if (forced === was && (forced === null || host === (status?.host ?? null))) return null
  return link.setForcedForge(project.id, repositoryId, forced, host)
}

/** What the dialogs of the section are given: the rules shown, and how each writes. */
function dialogContextOf({
  link,
  project,
  catalogue,
  forges,
  setForges,
  shown,
  delivery,
  draft,
  commit,
  close,
}: {
  link: Link
  project: Project
  catalogue: ReadonlyArray<Command>
  forges: ReadonlyArray<ForgeRepositoryStatus> | null
  setForges: (next: ReadonlyArray<ForgeRepositoryStatus>) => void
  shown: DeliveryShown
  delivery: DeliveryProject
  draft: DeliveryRulesDraft
  commit: (change: Change) => Promise<void>
  close: () => void
}): DialogContext {
  return {
    rules: shown.rules,
    project,
    catalogue,
    forgeOf: (repositoryId) =>
      forges?.find((one) => one.repositoryId === repositoryId)?.forge ?? 'unknown',
    actionOf: (repositoryId, stepId) =>
      repositoryId === null
        ? draft.end.cleanup.find((one) => one.id === stepId)
        : actionIn(draft, delivery, repositoryId, stepId),
    toAction: (form, id, forge, before) =>
      actionOf(form.config, form.start, id, { commands: catalogue, forge, before }),
    edit: {
      template: (kind, value) => commit((rules) => withTemplate(rules, delivery, kind, value)),
      push: ({ placement, start }) =>
        commit((rules) => withPushIn(rules, delivery, placement, start)),
      reviewers: (reviewers) =>
        commit((rules) =>
          withPreparation(rules, delivery, { reviewers: reviewers.map((one) => one.handle) }),
        ),
      repository: (repositoryId, chosen) =>
        writeRepository(link, project, forges, repositoryId, chosen).then((answered) => {
          if (answered !== null) setForges(answered)
        }),
      stepSaved: (repositoryId, step) =>
        commit((rules) => withStepSaved(rules, delivery, repositoryId, step)),
      stepRemoved: (repositoryId, stepId) =>
        commit((rules) => withStepRemoved(rules, delivery, repositoryId, stepId)),
      stepAdded: (repositoryId, moment, after, step) =>
        commit((rules) => withStepAdded(rules, delivery, repositoryId, moment, after, step)),
      cleanupSaved: (step) => commit((rules) => withCleanupSaved(rules, step)),
      cleanupAdded: (step) => commit((rules) => withCleanupAdded(rules, step)),
    },
    remotesOf: (repositoryId) =>
      link.remotes(repositoryId).then((remotes) => remotes.map((one) => one.name)),
    close,
  }
}

/** The repositories whose forge's command line keeps the forge's steps waiting. */
const troubledOf = (shown: DeliveryShown | null): string[] =>
  shown?.rules.repositories
    .filter(
      (one) => one.forge.kind !== 'none' && one.forge.cli !== null && one.forge.cli !== 'ready',
    )
    .map((one) => one.path) ?? []

/** The delivery rules of a Project: the pull requests, the waves and the End. */
export function DeliveryPart({
  link,
  engineReady,
  projectId,
  project,
  catalogue,
  show,
  copy,
  linked,
  onProblem,
}: DeliveryPartProps): ReactNode {
  const [forges, setForges] = useForges(link, engineReady, projectId)
  const { view, working, commit, setView } = useRules(
    link,
    engineReady,
    projectId,
    forges,
    onProblem,
  )
  const [checking, setChecking] = useState<ReadonlyArray<string>>([])
  /** Why the last change made on a line could not be written, in words. */
  const [refused, setRefused] = useState<string | undefined>(undefined)
  // A dialog left open over a section that is no longer shown closes with it.
  useEffect(() => () => show(null), [show])

  const saved = valueOf(view)
  const world =
    project === null || saved === null || working === null
      ? null
      : {
          project,
          draft: working.draft,
          proposed: saved.proposedDependencies,
          forges,
          remotes: new Map<string, ReadonlyArray<string>>(),
          commands: catalogue,
          problems: working.problems,
        }
  const delivery = world === null ? null : deliveryProjectOf(world)
  const shown = world === null ? null : shownOf(world)

  /** A change made on a line: what refuses it is said under the section's head. */
  const act = (change: (on: DeliveryProject) => Change): void => {
    if (delivery === null) return
    setRefused(undefined)
    commit(change(delivery)).catch((failure: Error) => setRefused(sentenceOf(failure)))
  }
  const idOf = (path: string): string =>
    project?.repositories.find((one) => one.path === path)?.id ?? path
  const checked = (path: string): void =>
    setChecking((before) => before.filter((one) => one !== path))

  const open = (target: DeliveryTarget): void => {
    if (shown === null || project === null || delivery === null || working === null) return
    const context = dialogContextOf({
      link,
      project,
      catalogue,
      forges,
      setForges,
      shown,
      delivery,
      draft: working.draft,
      commit,
      close: () => show(null),
    })
    show(deliveryDialogOf(target, context))
  }

  // Opened by a link, the section waits for the forges, to unfold those in trouble at once.
  const rules = linked && forges === null ? null : (shown?.rules ?? null)
  const unread = view.kind === 'failed' ? view.sentence : undefined
  const error = [unread, refused, shown?.elsewhere].filter((one) => one !== undefined).join(' ')

  return (
    <DeliveryRulesSection
      rules={rules}
      refusals={shown?.refusals}
      error={error === '' ? undefined : error}
      initiallyOpen={linked ? troubledOf(shown) : []}
      checking={checking}
      onOpen={open}
      onToggle={(rule, on) =>
        act((where) =>
          rule === 'reviewDrafts'
            ? (draft) => withReviewDrafts(draft, on)
            : (draft) => withPreparation(draft, where, { requireApproval: on }),
        )
      }
      onPreset={(path, preset) =>
        act((where) => (draft) => withPreset(draft, where, idOf(path), preset))
      }
      onPutBack={(path, id) => act(() => (draft) => withStepPutBack(draft, idOf(path), id))}
      onReset={(path, id) => act(() => (draft) => withStepReset(draft, idOf(path), id))}
      onAcceptDependency={(dependency) => {
        setRefused(undefined)
        link
          .acceptDependencies(projectId, [
            { repositoryId: idOf(dependency.repository), deliversAfter: idOf(dependency.on) },
          ])
          .then(setView, (failure: Error) => setRefused(sentenceOf(failure)))
      }}
      onRemoveCleanup={(id) => act(() => (draft) => withCleanupRemoved(draft, id))}
      onCheckAgain={(path) => {
        setChecking((before) => [...before, path])
        link.checkForgeAgain(projectId, idOf(path)).then(
          (statuses) => {
            setForges(statuses)
            checked(path)
          },
          (failure: Error) => {
            checked(path)
            setRefused(sentenceOf(failure))
          },
        )
      }}
      onCopy={copy}
    />
  )
}
