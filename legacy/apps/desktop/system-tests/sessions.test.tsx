/**
 * The session screen, painted on the real GPU test renderer against a temporary profile.
 *
 * Nothing is mocked below the screen: every assertion reads what was painted after the profile
 * answered, so a screen showing something the profile does not hold fails here. An action
 * taken outside a native event is followed by `settle`, which lets React land the update
 * before the frame is painted.
 */

import { describe, expect, test } from 'bun:test'

import { TEST_RENDERER_PAINTS } from '../test-setup.ts'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createTestRoot } from '@gpuix/react/testing'
import type { TestRoot } from '@gpuix/react/testing'
import { DEFAULT_THEME, ThemeProvider, light } from '@hemera/ui'
import { openProfile } from '@hemera/runtime'
import type { OpenProfile, StoreContext } from '@hemera/runtime'

import { folderProblem } from '#platform/workspace.ts'
import { SessionsPage } from '#ui/sessions/sessions-page.tsx'
import { useSessions } from '#ui/sessions/use-sessions.ts'
import type { SessionsModel } from '#ui/sessions/use-sessions.ts'
import { THEME_OPTIONS } from '#ui/sessions/dialogs.tsx'

const NOW = 1_789_000_000_000

interface TreeNode {
  id: number
  type: string
  style?: Record<string, unknown>
  text?: string | null
  testId?: string
  children?: TreeNode[]
}

function find(node: TreeNode | null | undefined, testId: string): TreeNode | null {
  if (node === null || node === undefined) return null
  if (node.testId === testId) return node
  for (const child of node.children ?? []) {
    const found = find(child, testId)
    if (found !== null) return found
  }
  return null
}

function nodeOf(root: TestRoot, testId: string): TreeNode {
  const found = find(root.renderer.toJSON() as TreeNode, testId)
  if (found === null) throw new Error(`no element with testId ${testId}`)
  return found
}

function maybeNodeOf(root: TestRoot, testId: string): TreeNode | null {
  return find(root.renderer.toJSON() as TreeNode, testId)
}

function textsOf(node: TreeNode): string[] {
  const texts: string[] = []
  if (node.type === 'text' && typeof node.text === 'string') texts.push(node.text)
  for (const child of node.children ?? []) texts.push(...textsOf(child))
  return texts
}

/** Every text painted by the window. */
function paintedTexts(root: TestRoot): string[] {
  return textsOf(root.renderer.toJSON() as TreeNode)
}

/** The bodies painted in the thread, without the time each entry shows beside it. */
function bodiesOf(root: TestRoot): string[] {
  return textsOf(nodeOf(root, 'thread')).filter((text) => !/^\d{1,2}:\d{2}$/.test(text))
}

interface HarnessProps {
  context: StoreContext
  onModel: (model: SessionsModel) => void
}

function Harness({ context, onModel }: HarnessProps) {
  const model = useSessions({ context, inspectFolder: folderProblem, now: () => NOW })
  onModel(model)
  return (
    <ThemeProvider name={model.theme} onThemeChange={model.setTheme}>
      <SessionsPage model={model} />
    </ThemeProvider>
  )
}

interface Mounted {
  root: TestRoot
  /** The model of the last painted frame. */
  model: () => SessionsModel
  /** Lets React land what an action outside a native event asked for, then paints. */
  settle: () => Promise<void>
}

function mount(context: StoreContext): Mounted {
  let latest: SessionsModel | null = null
  const root = createTestRoot({ width: 1280, height: 800 })
  root.render(<Harness context={context} onModel={(model) => (latest = model)} />)
  root.renderer.flush()
  return {
    root,
    model: () => {
      if (latest === null) throw new Error('the screen painted no model')
      return latest as SessionsModel
    },
    settle: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      root.renderer.flush()
    },
  }
}

/** Presses a painted control the way the keyboard does. */
function press(root: TestRoot, testId: string): void {
  root.renderer.nativeSimulateKeystrokes(nodeOf(root, testId).id, 'enter')
  root.renderer.flush()
}

interface Fixture {
  profile: OpenProfile
  context: StoreContext
  /** Two folders of documents, standing in for the user's own. */
  documents: string
  other: string
}

async function withScreen(body: (fixture: Fixture) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'hemera-screen-'))
  const documents = mkdtempSync(join(tmpdir(), 'hemera-documents-'))
  const other = mkdtempSync(join(tmpdir(), 'hemera-other-'))
  let count = 0
  const profile = openProfile({ directory, now: NOW })
  try {
    await body({
      profile,
      context: {
        database: profile.database,
        ids: { next: () => `id-${(count += 1)}` },
        now: NOW,
      },
      documents,
      other,
    })
  } finally {
    profile.database.close(true)
    rmSync(directory, { recursive: true, force: true })
    rmSync(documents, { recursive: true, force: true })
    rmSync(other, { recursive: true, force: true })
  }
}

describe.skipIf(!TEST_RENDERER_PAINTS)('Dossier inaccessible', () => {
  test('a folder that cannot be read is refused by name, and no project is created', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        const missing = join(documents, 'not-there')
        expect(model().addProject({ name: 'Hemera', path: missing })).toBe(false)
        await settle()

        expect(model().projects).toEqual([])
        expect(model().failure ?? '').toContain(missing)
        expect(textsOf(nodeOf(root, 'failure')).join(' ')).toContain('cannot be opened')
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Aucune Session', () => {
  test('a project without a session says so and offers to create one, with no fake entry', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()

        expect(model().sessions).toEqual([])
        expect(textsOf(nodeOf(root, 'no-session'))).toContain('No session yet')
        expect(maybeNodeOf(root, 'no-session-action')).not.toBeNull()

        // The only session-looking control is the way to create one.
        expect(maybeNodeOf(root, 'session-id-1')).toBeNull()
      } finally {
        root.unmount()
      }
    })
  })

  test('the offered creation really creates the session of the active project', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()

        press(root, 'no-session-action')

        expect(model().sessions).toHaveLength(1)
        expect(model().sessions[0]?.mission).toBe('free')
        expect(paintedTexts(root)).toContain('Untitled session')
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Travaux parallèles depuis la sidebar', () => {
  test('two sessions stay reachable from the sidebar with their own threads', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()
        model().sendMessage('about the renderer')
        await settle()
        const first = model().activeSessionId ?? ''

        model().startSession()
        await settle()
        model().sendMessage('about the migration')
        await settle()
        const second = model().activeSessionId ?? ''

        expect(first).not.toBe('')
        expect(first).not.toBe(second)
        expect(bodiesOf(root)).toContain('about the migration')

        model().selectSession(first)
        await settle()
        expect(bodiesOf(root)).toContain('about the renderer')
        expect(bodiesOf(root)).not.toContain('about the migration')

        // Both are listed at once: no entity stands between the user and a session.
        expect(maybeNodeOf(root, `session-${first}`)).not.toBeNull()
        expect(maybeNodeOf(root, `session-${second}`)).not.toBeNull()
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Brouillon non envoyé', () => {
  test('text left in the composer is no message of the thread', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()

        root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'composer-field').id, 'a b c')
        root.renderer.flush()

        expect(model().messages).toEqual([])
        expect(bodiesOf(root)).toEqual([])
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Bascule entre deux Projets', () => {
  test('switching projects shows their own sessions and keeps both', async () => {
    await withScreen(async ({ context, documents, other }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()
        model().sendMessage('of the first project')
        await settle()
        const firstProject = model().activeProjectId ?? ''

        model().addProject({ name: 'Nyx', path: other })
        await settle()
        model().startSession()
        await settle()
        model().sendMessage('of the second project')
        await settle()
        const secondProject = model().activeProjectId ?? ''

        expect(firstProject).not.toBe('')
        expect(firstProject).not.toBe(secondProject)
        expect(bodiesOf(root)).toContain('of the second project')

        model().selectProject(firstProject)
        await settle()
        expect(model().sessions).toHaveLength(1)
        expect(bodiesOf(root)).toContain('of the first project')

        model().selectProject(secondProject)
        await settle()
        expect(bodiesOf(root)).toContain('of the second project')
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Projet actif restauré', () => {
  test('the project active at closing time is the one selected at the next launch', async () => {
    await withScreen(async ({ context, documents, other }) => {
      const first = mount(context)
      let chosen = ''
      try {
        first.model().addProject({ name: 'Hemera', path: documents })
        await first.settle()
        first.model().addProject({ name: 'Nyx', path: other })
        await first.settle()

        // The second project is the one added last, so select the first one back.
        chosen = first.model().projects[0]?.id ?? ''
        first.model().selectProject(chosen)
        await first.settle()
        expect(first.model().activeProjectId).toBe(chosen)
      } finally {
        first.root.unmount()
      }

      const second = mount(context)
      try {
        expect(second.model().activeProjectId).toBe(chosen)
      } finally {
        second.root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Projet actif devenu indisponible', () => {
  test('an unreachable folder is reported and its data is kept', async () => {
    await withScreen(async ({ context, documents, other }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()
        model().sendMessage('written while the folder existed')
        await settle()
        const broken = model().activeProjectId ?? ''

        model().addProject({ name: 'Nyx', path: other })
        await settle()
        const reachable = model().activeProjectId ?? ''

        rmSync(documents, { recursive: true, force: true })
        model().selectProject(broken)
        await settle()

        expect(model().unavailableFolder).not.toBeNull()
        expect(maybeNodeOf(root, 'folder-unavailable')).not.toBeNull()
        expect(model().projects).toHaveLength(2)
        expect(model().sessions).toHaveLength(1)
        expect(bodiesOf(root)).toContain('written while the folder existed')

        // Another project stays selectable, and nothing was removed.
        model().selectProject(reachable)
        await settle()
        expect(maybeNodeOf(root, 'folder-unavailable')).toBeNull()
        expect(model().projects).toHaveLength(2)
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Session sélectionnée conservée', () => {
  test('after a restart the sidebar lists the sessions and the one consulted reopens', async () => {
    await withScreen(async ({ context, documents }) => {
      const first = mount(context)
      let consulted = ''
      try {
        first.model().addProject({ name: 'Hemera', path: documents })
        await first.settle()
        first.model().startSession()
        await first.settle()
        first.model().sendMessage('the older thread')
        await first.settle()
        consulted = first.model().activeSessionId ?? ''

        first.model().startSession()
        await first.settle()
        first.model().sendMessage('the newer thread')
        await first.settle()
      } finally {
        first.root.unmount()
      }

      const second = mount(context)
      try {
        expect(second.model().sessions).toHaveLength(2)
        expect(maybeNodeOf(second.root, `session-${consulted}`)).not.toBeNull()

        second.model().selectSession(consulted)
        await second.settle()
        expect(bodiesOf(second.root)).toContain('the older thread')
      } finally {
        second.root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)("Session archivée depuis l'écran", () => {
  test('archiving hides the session from the current list and restoring brings it back', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()
        model().sendMessage('one')
        await settle()
        model().sendMessage('two')
        await settle()
        const archived = model().activeSessionId ?? ''

        press(root, 'archive-session')

        expect(model().sessions).toEqual([])
        expect(model().archivedCount).toBe(1)
        expect(maybeNodeOf(root, `session-${archived}`)).toBeNull()

        press(root, 'toggle-archived')
        expect(model().showingArchived).toBe(true)
        expect(maybeNodeOf(root, `session-${archived}`)).not.toBeNull()
        expect(bodiesOf(root)).toEqual(['one', 'two'])

        press(root, 'archive-session')
        expect(model().archivedCount).toBe(0)

        model().showArchived(false)
        await settle()
        expect(model().sessions).toHaveLength(1)
        expect(bodiesOf(root)).toEqual(['one', 'two'])
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Aucune suppression proposée', () => {
  test('the screen offers archiving and nothing that deletes', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()

        const labels = paintedTexts(root).map((text) => text.toLowerCase())
        for (const forbidden of ['delete', 'remove', 'destroy']) {
          expect(labels.some((label) => label.includes(forbidden))).toBe(false)
        }
        expect(maybeNodeOf(root, 'archive-session')).not.toBeNull()
        expect(Object.keys(model()).some((key) => key.toLowerCase().includes('delete'))).toBe(false)
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Aucun provider disponible', () => {
  test('the thread works with no provider configured and answers nothing by itself', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()
        model().sendMessage('a question nobody answers')
        await settle()

        expect(model().messages).toHaveLength(1)
        expect(model().messages.every((entry) => entry.author === 'human')).toBe(true)
        expect(bodiesOf(root)).toEqual(['a question nobody answers'])
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)("Édition de la configuration depuis l'écran", () => {
  test('an edited configuration is stored and shown, and the folder stays untouched', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()

        expect(
          model().configureProject({
            name: 'Hemera cockpit',
            repositories: ['./sources/api', './sources/front'],
          }),
        ).toBe(true)
        await settle()

        expect(model().configuration?.name).toBe('Hemera cockpit')
        expect(model().configuration?.repositories).toEqual(['./sources/api', './sources/front'])
        expect(paintedTexts(root)).toContain('Hemera cockpit')
        expect(readdirSync(documents)).toEqual([])
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)("Configuration invalide refusée dans l'écran", () => {
  test('a refused configuration names the cause and keeps the previous one intact', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().configureProject({ name: 'Hemera', repositories: ['./sources/api'] })
        await settle()

        expect(model().configureProject({ name: 'Hemera', repositories: ['../outside'] })).toBe(
          false,
        )
        await settle()

        expect(model().failure ?? '').toContain('../outside')
        expect(textsOf(nodeOf(root, 'failure')).join(' ')).toContain('refused')
        expect(model().configuration?.repositories).toEqual(['./sources/api'])
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Titre dérivé du premier message dans la sidebar', () => {
  test('the first message names the session, and a renamed one keeps its title', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()
        expect(paintedTexts(root)).toContain('Untitled session')

        model().sendMessage('Migrate the profile of the previous version')
        await settle()
        const proposed = model().activeSession?.title ?? ''
        expect(proposed).toContain('Migrate the profile')
        expect(paintedTexts(root)).toContain(proposed)

        expect(model().renameSession('Profile migration')).toBe(true)
        await settle()
        model().sendMessage('a message that proposes nothing anymore')
        await settle()

        expect(model().activeSession?.title).toBe('Profile migration')
        expect(paintedTexts(root)).toContain('Profile migration')
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Panneaux de décision du Projet', () => {
  test('the new-project panel asks for a name and a folder that must already exist', async () => {
    await withScreen(async ({ context }) => {
      const { root } = mount(context)
      try {
        press(root, 'new-project')

        expect(maybeNodeOf(root, 'new-project-dialog')).not.toBeNull()
        expect(maybeNodeOf(root, 'new-project-name')).not.toBeNull()
        expect(maybeNodeOf(root, 'new-project-path')).not.toBeNull()
        expect(paintedTexts(root)).toContain('Folder of the main workspace')
      } finally {
        root.unmount()
      }
    })
  })

  test('the configuration panel shows the stored configuration and the folder of main', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()

        press(root, 'project-settings')

        expect(textsOf(nodeOf(root, 'settings-path'))).toEqual([documents])
        expect(paintedTexts(root)).toContain('Repository locations')
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Bascule de thème à chaud', () => {
  test('the whole window changes theme without losing the session, the draft or the sizes', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()
        model().sendMessage('written before the switch')
        await settle()
        model().setSidebarWidth(320)
        await settle()

        const session = model().activeSessionId
        root.renderer.nativeSimulateKeystrokes(nodeOf(root, 'composer-field').id, 'a b c')
        root.renderer.flush()
        const before = nodeOf(root, 'shell').style?.backgroundColor

        model().setTheme('light')
        await settle()

        expect(model().theme).toBe('light')
        expect(nodeOf(root, 'shell').style?.backgroundColor).not.toBe(before)
        expect(nodeOf(root, 'shell').style?.backgroundColor).toBe(light.colors.bg)

        // Nothing was remounted: the session, its thread and the panel width are untouched.
        expect(model().activeSessionId).toBe(session)
        expect(bodiesOf(root)).toEqual(['written before the switch'])
        expect(model().sidebarWidth).toBe(320)
        expect(maybeNodeOf(root, 'composer-field')).not.toBeNull()
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Thème restauré après redémarrage', () => {
  test('the theme chosen is the one the next launch opens on', async () => {
    await withScreen(async ({ context, documents }) => {
      const first = mount(context)
      try {
        first.model().addProject({ name: 'Hemera', path: documents })
        await first.settle()
        first.model().setTheme('light')
        await first.settle()
        expect(first.model().theme).toBe('light')
      } finally {
        first.root.unmount()
      }

      const second = mount(context)
      try {
        expect(second.model().theme).toBe('light')
        expect(nodeOf(second.root, 'shell').style?.backgroundColor).toBe(light.colors.bg)
      } finally {
        second.root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Suivi du thème système indisponible', () => {
  test('no system choice is offered, and the default is the dark theme', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        expect(model().theme).toBe(DEFAULT_THEME)
        expect(DEFAULT_THEME).toBe('dark')

        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        press(root, 'project-settings')

        expect(THEME_OPTIONS.map((option) => option.value)).toEqual(['dark', 'light'])
        expect(paintedTexts(root)).not.toContain('System')
        expect(maybeNodeOf(root, 'settings-theme')).not.toBeNull()
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Onglet de Projet actif', () => {
  test('selecting another tab changes the active one and the sessions listed', async () => {
    await withScreen(async ({ context, documents, other }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()
        model().sendMessage('of the first project')
        await settle()
        const first = model().activeProjectId ?? ''

        model().addProject({ name: 'Nyx', path: other })
        await settle()
        const second = model().activeProjectId ?? ''

        // The active tab is painted apart from the others.
        const activeTab = nodeOf(root, `project-${second}`)
        const restingTab = nodeOf(root, `project-${first}`)
        expect(activeTab.style?.backgroundColor).not.toBe(restingTab.style?.backgroundColor)

        press(root, `project-${first}`)

        expect(model().activeProjectId).toBe(first)
        expect(nodeOf(root, `project-${first}`).style?.backgroundColor).toBe(
          activeTab.style?.backgroundColor,
        )
        expect(bodiesOf(root)).toContain('of the first project')

        // Exactly one project is active at a time.
        const active = model().projects.filter((project) => project.id === model().activeProjectId)
        expect(active).toHaveLength(1)
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)(
  'Fonctionnalité absente du lot présentée par la maquette',
  () => {
    test('the screen shows nothing the lot does not deliver, not even disabled', async () => {
      await withScreen(async ({ context, documents }) => {
        const { root, model, settle } = mount(context)
        try {
          model().addProject({ name: 'Hemera', path: documents })
          await settle()
          model().startSession()
          await settle()

          // Everything of the mockup that belongs to a later lot: no provider, no model
          // picker, no mission, no agent, no cost, no search.
          const painted = paintedTexts(root).map((text) => text.toLowerCase())
          for (const absent of [
            'provider',
            'model',
            'agent',
            'mission',
            'tokens',
            'cost',
            'search',
          ]) {
            expect(painted.some((text) => text.includes(absent))).toBe(false)
          }
        } finally {
          root.unmount()
        }
      })
    })
  },
)

describe.skipIf(!TEST_RENDERER_PAINTS)("Aucune réponse d'agent au lot 1", () => {
  test('no provider is presented and no agent reply is ever simulated', async () => {
    await withScreen(async ({ context, documents }) => {
      const { root, model, settle } = mount(context)
      try {
        model().addProject({ name: 'Hemera', path: documents })
        await settle()
        model().startSession()
        await settle()
        model().sendMessage('is anybody there?')
        await settle()
        model().sendMessage('still nobody?')
        await settle()

        // The thread holds exactly what the user wrote, in order, and nothing else.
        expect(bodiesOf(root)).toEqual(['is anybody there?', 'still nobody?'])
        expect(model().messages.every((entry) => entry.author === 'human')).toBe(true)

        // No provider, no generation marker, no waiting state is shown.
        const painted = paintedTexts(root).map((text) => text.toLowerCase())
        for (const absent of ['thinking', 'generating', 'typing', 'assistant', 'provider']) {
          expect(painted.some((text) => text.includes(absent))).toBe(false)
        }
      } finally {
        root.unmount()
      }
    })
  })
})

describe.skipIf(!TEST_RENDERER_PAINTS)('Démonstration inaccessible en production', () => {
  test('the screen offers no way into the demonstration unless it is given one', async () => {
    await withScreen(async ({ context }) => {
      // The screen is mounted the way a prod package mounts it: without the action, because
      // the channel of that package exposes no route to the page at all.
      const { root, settle } = mount(context)
      try {
        await settle()
        expect(maybeNodeOf(root, 'open-showcase')).toBeNull()
      } finally {
        root.unmount()
      }
    })
  })
})
