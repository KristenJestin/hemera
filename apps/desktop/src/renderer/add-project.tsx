import {
  InvalidFolder,
  InvalidProjectName,
  InvalidRepositoryPath,
  type NewProject,
  type Project,
} from '@hemera/ipc'
import { AddProject, type FoundRepository } from '@hemera/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { SetupOffer } from './setup-cards.ts'

/** What adding a Project asks of the window: the engine's two calls, and main's picker. */
export interface AddingTools {
  readonly detect: (folder: string) => Promise<ReadonlyArray<string>>
  readonly create: (project: NewProject) => Promise<Project>
  readonly chooseFolder: () => Promise<string | null>
}

/** How long the folder's field waits for the typing to settle before Hemera looks in it. */
const TYPING_SETTLES_MS = 400

/** The name a Project is given until the user writes another: its folder's. */
export function folderName(folder: string): string {
  return (
    folder
      .split(/[\\/]/)
      .findLast((part) => part.trim() !== '')
      ?.trim() ?? ''
  )
}

/** The Project to create: its name, its folder, and the repositories ticked, in their order. */
export function newProjectOf(
  folder: string,
  name: string,
  found: ReadonlyArray<FoundRepository>,
): NewProject {
  return {
    name: name.trim(),
    mainCheckout: folder.trim(),
    repositories: found.filter((one) => one.chosen).map((one) => one.path),
  }
}

/** What refuses the Project, said where it concerns: its folder, its name, a path added by hand. */
export interface CreateRefusal {
  readonly folder?: string | undefined
  readonly name?: string | undefined
  readonly byHand?: string | undefined
  readonly foot?: string | undefined
}

export function createRefusalOf(
  failure: Error,
  found: ReadonlyArray<FoundRepository>,
): CreateRefusal {
  if (failure instanceof InvalidFolder) return { folder: failure.message }
  if (failure instanceof InvalidProjectName) return { name: failure.message }
  if (
    failure instanceof InvalidRepositoryPath &&
    found.some((one) => one.byHand === true && one.path === failure.path)
  ) {
    return { byHand: failure.message }
  }
  return { foot: failure.message }
}

export interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tools: AddingTools
  /** The Project created, once the engine has written it. */
  /** Who would run the setup, as the dialog offers it; null while it is read. */
  setupOffer: SetupOffer | null
  /** The Project created, once the engine has written it, and whether the user chose the setup. */
  onCreated: (project: Project, setUp: boolean) => void
}

/**
 * Whether the setup is proposed: ticked by default where an agent can run it, the user's own
 * choice once they have made one, and never where none can.
 */
export function settingUpOf(choice: boolean | null, setupOffer: SetupOffer | null): boolean {
  if (setupOffer === null || setupOffer.unavailable !== undefined) return false
  return choice ?? true
}

/**
 * Adding a Project in the window: the design's dialog, Hemera looking in the folder once the
 * typing settles (or at once when the picker gives one), what it found proposed, a repository
 * added by its path by hand, and the engine's refusal said where it concerns. The Project's mark
 * is left out: nothing keeps it yet.
 */
export function AddProjectDialog({
  open,
  onOpenChange,
  tools,
  setupOffer,
  onCreated,
}: AddProjectDialogProps): ReactNode {
  /** Whether the user chose to have an agent propose the rest of the setup; null until they do. */
  const [setUp, setSetUp] = useState<boolean | null>(null)
  const settingUp = settingUpOf(setUp, setupOffer)
  const [folder, setFolder] = useState('')
  const [name, setName] = useState('')
  // Named by hand: the folder's name no longer follows the folder. Read when it changes, never drawn.
  const named = useRef(false)
  const [found, setFound] = useState<ReadonlyArray<FoundRepository> | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [byHand, setByHand] = useState('')
  const [refusal, setRefusal] = useState<CreateRefusal>({})
  const [creating, setCreating] = useState(false)
  /** Which look in a folder is the current one: an answer about an earlier folder is dropped. */
  const looking = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const reset = (): void => {
    looking.current += 1
    if (timer.current !== null) clearTimeout(timer.current)
    setFolder('')
    setName('')
    named.current = false
    setFound(null)
    setDetecting(false)
    setByHand('')
    setRefusal({})
    setCreating(false)
    setSetUp(null)
  }

  const look = (at: string): void => {
    looking.current += 1
    const asked = looking.current
    if (at.trim() === '') {
      setDetecting(false)
      return
    }
    setDetecting(true)
    tools.detect(at.trim()).then(
      (paths) => {
        if (asked !== looking.current) return
        setDetecting(false)
        const detected = new Set(paths)
        setFound((before) => [
          ...paths.map((path) => ({ path, chosen: true })),
          ...(before ?? []).filter((one) => one.byHand === true && !detected.has(one.path)),
        ])
      },
      (failure: Error) => {
        if (asked !== looking.current) return
        setDetecting(false)
        setRefusal({ folder: failure.message })
      },
    )
  }

  const changeFolder = (next: string, now: boolean): void => {
    setFolder(next)
    setFound(null)
    setRefusal({})
    if (!named.current) setName(folderName(next))
    // The list holds its rows' shape from the first keystroke, not once the typing settles.
    setDetecting(next.trim() !== '')
    if (timer.current !== null) clearTimeout(timer.current)
    looking.current += 1
    if (now) look(next)
    else timer.current = setTimeout(() => look(next), TYPING_SETTLES_MS)
  }

  return (
    <AddProject
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
      folder={folder}
      onFolder={(next) => changeFolder(next, false)}
      onChooseFolder={() => {
        void tools.chooseFolder().then((chosen) => {
          if (chosen !== null) changeFolder(chosen, true)
        })
      }}
      folderError={refusal.folder}
      name={name}
      onName={(next) => {
        setName(next)
        named.current = true
      }}
      nameError={refusal.name}
      found={found}
      detecting={detecting}
      onChoose={(path, chosen) =>
        setFound((before) =>
          (before ?? []).map((one) =>
            one.path === path ? { path: one.path, chosen, byHand: one.byHand } : one,
          ),
        )
      }
      byHand={byHand}
      onByHand={setByHand}
      byHandError={refusal.byHand}
      onAddByHand={() => {
        const path = byHand.trim()
        if (path === '') return
        setFound((before) =>
          (before ?? []).some((one) => one.path === path)
            ? before
            : [...(before ?? []), { path, chosen: true, byHand: true }],
        )
        setByHand('')
      }}
      refused={refusal.foot}
      creating={creating}
      setup={setupOffer ?? undefined}
      setUp={settingUp}
      onSetUp={setSetUp}
      onCreate={() => {
        if (creating) return
        const asked = found ?? []
        setCreating(true)
        setRefusal({})
        tools.create(newProjectOf(folder, name, asked)).then(
          (project) => {
            const chosen = settingUp
            reset()
            onOpenChange(false)
            onCreated(project, chosen)
          },
          (failure: Error) => {
            setCreating(false)
            setRefusal(createRefusalOf(failure, asked))
          },
        )
      }}
    />
  )
}
