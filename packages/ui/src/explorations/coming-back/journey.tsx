import type { StoryObj } from '@storybook/react-vite'
import type { ComponentType, ReactElement, ReactNode } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ContentHeader } from '../../shell/content-header.tsx'
import {
  CHATS,
  DONE,
  MISSIONS,
  NEEDS,
  NIGHT,
  QUESTIONS,
  RECENT,
  RESULTS,
  manyMissions,
} from './fixtures.ts'
import {
  type ExploredMission,
  type HomeProps,
  type MissionProps,
  type ProjectProps,
  type Triage,
  stageLabel,
} from './parts.tsx'

/**
 * The journey the screens are played on, story by story: the same states, the same data, the
 * same checks.
 */
export interface Screens {
  Project: ComponentType<ProjectProps>
  Mission: ComponentType<MissionProps>
  Home: ComponentType<HomeProps>
}

function missionOf(key: string): ExploredMission {
  const found = MISSIONS.find((mission) => mission.key === key)
  if (found === undefined) throw new Error(`No mission ${key} in the fixtures`)
  return found
}

/** The sheet a page sits on, as the window shows it. */
function Sheet({ children }: { children: ReactNode }): ReactNode {
  return <div className="flex min-h-screen flex-col bg-surface-content">{children}</div>
}

/** Whether a mark is said on screen, as a glyph's name or in words. */
function says(canvasElement: HTMLElement, words: string): boolean {
  const canvas = within(canvasElement)
  return (
    canvas.queryAllByRole('img', { name: words }).length > 0 ||
    canvas.queryAllByText(words).length > 0
  )
}

export function journeyOf({ Project, Mission, Home }: Screens) {
  const project = (
    missions: readonly ExploredMission[],
    done: readonly ExploredMission[] = DONE,
    typed?: string,
    triage?: Triage,
  ): ReactElement => (
    <Sheet>
      <Project
        missions={missions}
        done={done}
        chats={CHATS}
        results={RESULTS}
        typed={typed}
        triage={triage}
        onOpenMission={fn()}
        onCreate={fn()}
        onOpenChat={fn()}
        onOpenSpec={fn()}
        onOpenSettings={fn()}
      />
    </Sheet>
  )
  const mission = (key: string, needs: readonly string[] = []): ReactElement => {
    const shown = missionOf(key)
    return (
      <div className="flex h-screen flex-col bg-surface-content">
        <ContentHeader
          folded={false}
          onFold={fn()}
          crumbs={[
            { id: 'project', label: 'Acme', onPress: fn() },
            { id: 'mission', label: shown.key, mono: true, onPress: fn() },
            { id: 'stage', label: stageLabel(shown) },
          ]}
        />
        <Mission mission={shown} needs={needs} onCancel={fn()} onAction={fn()} onOpenSpec={fn()} />
      </div>
    )
  }
  const home = (props: Partial<HomeProps>): ReactElement => (
    <Sheet>
      <Home
        today="Friday 9 October"
        needs={NEEDS}
        questions={QUESTIONS}
        night={NIGHT}
        recent={RECENT}
        onOpen={fn()}
        {...props}
      />
    </Sheet>
  )

  return {
    /** A Project lived in: one mission per stage, every mark once, Done folded, its Chats. */
    ProjectFilled: {
      render: () => project(MISSIONS),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        for (const stage of ['Shipping', 'Review', 'Building', 'Planning', 'Ready']) {
          expect(canvas.getByRole('list', { name: `${stage} missions` })).toBeInTheDocument()
        }
        expect(canvas.queryByRole('list', { name: 'Done missions' })).toBeNull()
        expect(says(canvasElement, 'Blocked by ACME-9')).toBe(true)
        expect(says(canvasElement, 'Blocked by shared database · ACME-15')).toBe(true)
        expect(says(canvasElement, 'Waiting on CI on acme/shop#52')).toBe(true)
        expect(says(canvasElement, 'web changed outside Hemera')).toBe(true)
        expect(says(canvasElement, 'Outdated')).toBe(true)
        expect(says(canvasElement, 'Fixing')).toBe(true)
        expect(canvas.getByRole('list', { name: 'Chats' })).toBeInTheDocument()
      },
    },
    /** A Project with no mission yet: the field, and the room the missions will take. */
    ProjectEmpty: {
      render: () => project([], []),
      play: async ({ canvasElement }) => {
        expect(within(canvasElement).getByText('No mission yet')).toBeVisible()
      },
    },
    /** Thirty missions, every title and event long: the page scrolls, no row grows. */
    ProjectMany: {
      render: () => project(manyMissions()),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const title = canvas.getAllByText(/^Export invoices as CSV/)[0]!
        expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
      },
    },
    /** "export" typed: missions first, then tickets, and Create a mission last. */
    ProjectSearching: {
      render: () => project(MISSIONS, DONE, 'export'),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const found = canvas.getByRole('list', { name: 'Found' })
        const choices = within(found).getAllByRole('button')
        expect(choices[0]).toHaveTextContent('ACME-12')
        expect(choices.at(-1)).toHaveTextContent('Create a mission “export”')
      },
    },
    /** The agent reads what was typed: its loading face under the field. */
    ProjectTriageReading: {
      render: () => project(MISSIONS, DONE, 'Export the audit log', { kind: 'reading' }),
      play: async ({ canvasElement }) => {
        expect(
          within(canvasElement).getByRole('status', { name: 'Hemera reads it' }),
        ).toBeInTheDocument()
      },
    },
    /** The agent's answer: this belongs to an existing mission. */
    ProjectTriageBelongs: {
      render: () =>
        project(MISSIONS, DONE, 'Keep the date range in the file name', {
          kind: 'belongs',
          key: 'ACME-12',
        }),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByText('This belongs to ACME-12')).toBeVisible()
        expect(canvas.getByRole('button', { name: 'Start a mission anyway' })).toBeVisible()
      },
    },
    /** The agent's answer: too small for a mission, the Chat is the place. */
    ProjectTriageSmall: {
      render: () => project(MISSIONS, DONE, 'Fix the typo in the footer', { kind: 'small' }),
      play: async ({ canvasElement }) => {
        expect(within(canvasElement).getByRole('button', { name: 'Ask in a Chat' })).toBeVisible()
      },
    },
    /** From the keyboard: to the field, a search, and the first thing found. */
    ProjectFocused: {
      render: () => project(MISSIONS),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const field = canvas.getByRole('textbox', { name: 'Start a mission in Acme' })
        // The header's controls first (the settings, and the living spec where the header has it).
        await userEvent.tab()
        await userEvent.tab()
        if (document.activeElement !== field) await userEvent.tab()
        expect(field).toHaveFocus()
        await userEvent.keyboard('export')
        const found = await canvas.findByRole('list', { name: 'Found' })
        await userEvent.tab()
        expect(within(found).getAllByRole('button')[0]).toHaveFocus()
      },
    },
    /** Planning: the Spec not frozen yet, Freeze as its action, the needs at the top. */
    MissionPlanning: {
      render: () =>
        mission('ACME-14', ['Who may read the audit log?', 'How long is the log kept?']),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByRole('button', { name: 'Freeze' })).toBeVisible()
        expect(canvas.getByRole('button', { name: 'Cancel' })).toBeVisible()
        expect(
          within(canvas.getByRole('list', { name: 'Needs you' })).getAllByRole('listitem'),
        ).toHaveLength(2)
        expect(canvas.queryByRole('img', { name: 'Spec frozen' })).toBeNull()
      },
    },
    /** Ready, frozen, blocked by a dependency: Launch, and the cause said. */
    MissionBlockedByDependency: {
      render: () => mission('ACME-16'),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByRole('button', { name: 'Launch' })).toBeVisible()
        expect(canvas.getByRole('img', { name: 'Spec frozen' })).toBeInTheDocument()
        expect(says(canvasElement, 'Blocked by ACME-9')).toBe(true)
      },
    },
    /** Building, blocked by a shared resource another mission holds. */
    MissionBlockedByResource: {
      render: () => mission('ACME-17'),
      play: async ({ canvasElement }) => {
        expect(says(canvasElement, 'Blocked by shared database · ACME-15')).toBe(true)
        expect(within(canvasElement).queryByRole('button', { name: 'Launch' })).toBeNull()
      },
    },
    /** Review, round 1: Ship, a repository changed outside Hemera, a fix under way, a need. */
    MissionReview: {
      render: () => mission('ACME-12', ['Run the migration on the shared database?']),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByRole('button', { name: 'Ship' })).toBeVisible()
        expect(says(canvasElement, 'web changed outside Hemera')).toBe(true)
        expect(says(canvasElement, 'Fixing')).toBe(true)
        expect(canvas.getByRole('link', { name: 'acme/shop#41' })).toBeInTheDocument()
      },
    },
    /** Shipping: no action of its own, waiting on someone, said with what it waits on. */
    MissionWaiting: {
      render: () => mission('ACME-18'),
      play: async ({ canvasElement }) => {
        expect(says(canvasElement, 'Waiting on CI on acme/shop#52')).toBe(true)
        expect(
          within(canvasElement).getByRole('img', { name: 'Waiting on someone' }),
        ).toBeInTheDocument()
      },
    },
    /** Ready but outdated: the ticket changed after the freeze. */
    MissionOutdated: {
      render: () => mission('ACME-19'),
      play: async ({ canvasElement }) => {
        expect(says(canvasElement, 'Outdated')).toBe(true)
      },
    },
    /** Cancel asks once, and says the work is kept; Keep it going leaves everything as it was. */
    MissionCancelling: {
      render: () => mission('ACME-15'),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
        const dialog = await within(document.body).findByRole('dialog', {
          name: 'Cancel ACME-15?',
        })
        expect(dialog).toHaveTextContent(/stay until you confirm the cleanup/)
        await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it going' }))
        await waitFor(() => {
          expect(within(document.body).queryByRole('dialog')).toBeNull()
        })
      },
    },
    /** The morning after a night with failures and finishes, two needs, two questions. */
    HomeMorning: {
      render: () => home({}),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByRole('region', { name: 'Questions' })).toBeInTheDocument()
        const night = canvas.getByRole('list', { name: 'Since you left' })
        expect(within(night).getByText(/T3 failed/)).toBeInTheDocument()
        expect(within(night).getByText(/Shipped: api and web merged/)).toBeInTheDocument()
        expect(within(night).getByText(/a teammate answered/)).toBeInTheDocument()
      },
    },
    /** No Planning question waits: the Questions group is not drawn. */
    HomeNoQuestion: {
      render: () => home({ questions: [] }),
      play: async ({ canvasElement }) => {
        expect(within(canvasElement).queryByRole('region', { name: 'Questions' })).toBeNull()
      },
    },
    /** Nothing waits and nothing happened: what an empty Home says. */
    HomeEmpty: {
      render: () => home({ needs: [], questions: [], night: [], recent: [] }),
      play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.queryByRole('list', { name: 'Since you left' })).toBeNull()
        expect(canvas.getByText('No mission yet.')).toBeInTheDocument()
      },
    },
  } satisfies Record<string, StoryObj>
}
