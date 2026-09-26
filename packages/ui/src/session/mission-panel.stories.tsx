import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button, IconButton } from '../components/button/button.tsx'
import { Tooltip, TooltipProvider } from '../components/tooltip/tooltip.tsx'
import {
  IconBolt,
  IconChecklist,
  IconChevronRight,
  IconFileText,
  IconListCheck,
  IconRobot,
  IconUser,
} from '../icons.ts'
import { MissionPanel } from './mission-panel.tsx'
import { type MissionRailGroup, MissionRail, type RailChoice } from './mission-rail.tsx'

/**
 * The panel a Session's mission opens beside the chat, alone and with nothing of a Spec in it: a
 * stand-in mission of tasks and workers, fed to the same rail the Spec's is drawn with. Folded by
 * default to a band, unfolded by the band or by the agent starting on something — unless the hand
 * folded it — and pushing the chat aside as it unfolds. The Spec panel is this shell with the
 * Spec's head, rail, stage and foot in its slots (`Blocks/Spec/SpecPanel`).
 */

/** A stand-in mission: tasks by status, and who works on them. */
function groupsOf(following: string | undefined): MissionRailGroup[] {
  return [
    {
      id: 'tasks',
      icon: IconListCheck,
      label: 'Tasks',
      tooltip: 'Tasks · show all',
      items: [
        { id: 't1', icon: IconFileText, label: 'Parse the file', attention: 'none' },
        {
          id: 't2',
          icon: IconBolt,
          label: 'Write the ledger',
          attention: following === 't2' ? 'writing' : 'empty',
          description: following === 't2' ? 'The agent is working on this' : 'Not started',
        },
        {
          id: 't3',
          icon: IconChecklist,
          label: 'Check the import',
          attention: 'review',
          description: 'To review',
        },
      ],
    },
    {
      id: 'workers',
      icon: IconRobot,
      label: 'Workers',
      tooltip: 'Workers · show all',
      items: [
        { id: 'w1', icon: IconRobot, label: 'Worker 1', count: 2, attention: 'none' },
        {
          id: 'you',
          icon: IconUser,
          label: 'You',
          count: 1,
          attention: 'edited',
          description: 'Edited by you',
        },
      ],
    },
  ]
}

const LABELS = new Map([
  ['t1', 'Parse the file'],
  ['t2', 'Write the ledger'],
  ['t3', 'Check the import'],
  ['w1', 'Worker 1'],
  ['you', 'You'],
  ['tasks', 'Tasks'],
  ['workers', 'Workers'],
])

/** The panel in a Session's row, beside a stand-in for the chat it pushes aside. */
function Row({
  defaultFolded,
  onFoldChange,
  width,
}: {
  defaultFolded?: boolean | undefined
  onFoldChange: (folded: boolean) => void
  /** How wide it unfolds: a Spec's share, or the chat's beside a build. */
  width?: 'wide' | 'narrow' | undefined
}): ReactNode {
  const [following, setFollowing] = useState<string | undefined>(undefined)
  // What the page asks of the fold, once it asks anything: the page keeps it in step with the
  // panel's own answer, as a caller that folds it itself does.
  const [asked, setAsked] = useState<boolean | undefined>(undefined)
  const [current, setCurrent] = useState<RailChoice>({ item: 't1' })
  const groups = groupsOf(following)
  const rail = {
    label: 'Parts of B-3',
    groups,
    current,
    onSelect: (item: string) => setCurrent({ item }),
    onSelectGroup: (group: string) => setCurrent({ group }),
  }
  const shown = 'item' in current ? current.item : current.group
  return (
    <TooltipProvider>
      <div className="@container flex h-screen min-h-0 bg-background text-foreground">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-3 p-6 text-sm text-muted-foreground">
          <p>
            The chat of the Session stands here, and takes whatever width the panel leaves it: all
            of it but the band while the panel is folded, and what is left beside it once unfolded.
          </p>
          <Button onClick={() => setFollowing('t2')}>Let the agent start the ledger</Button>
          <Button onClick={() => setAsked(true)}>Fold it from the page</Button>
        </div>
        <MissionPanel
          label="Build B-3"
          noun="build"
          defaultFolded={defaultFolded}
          folded={asked}
          width={width}
          onFoldChange={(folded) => {
            setAsked(folded)
            onFoldChange(folded)
          }}
          following={following}
          onFollow={() => setCurrent({ item: following ?? 't2' })}
          head={(fold) => (
            <header className="flex items-center gap-2.5 border-b border-border px-5 pt-4 pb-3">
              <h2 className="text-base font-semibold">B-3 · CSV invoice export</h2>
              <span className="ml-auto flex">
                <Tooltip label="Fold the build">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconChevronRight size="sm" />}
                    aria-label="Fold the build"
                    onClick={fold}
                  />
                </Tooltip>
              </span>
            </header>
          )}
          rail={<MissionRail {...rail} />}
          stage={
            <div role="region" aria-label="Stage of B-3" className="flex-1 px-10 pt-5 text-sm">
              {LABELS.get(shown)}
            </div>
          }
          band={<MissionRail {...rail} folded />}
        />
      </div>
    </TooltipProvider>
  )
}

const meta = {
  title: 'Blocks/Session/MissionPanel',
  component: Row,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { onFoldChange: fn() },
  argTypes: {
    defaultFolded: { control: 'boolean', description: 'Whether it starts folded to its band.' },
    width: {
      control: 'inline-radio',
      options: ['wide', 'narrow'],
      description: 'How wide it unfolds: a Spec’s share, or the chat’s beside a build.',
    },
    onFoldChange: { description: 'Told each time the panel folds or unfolds.' },
  },
} satisfies Meta<typeof Row>

export default meta

type Story = StoryObj<typeof meta>

/** The band's own width, read from the theme's rem: three of them. */
const BAND = 48

function panelOf(canvasElement: HTMLElement): HTMLElement {
  return within(canvasElement).getByRole('region', { name: 'Build B-3' })
}

/** Nothing of a Spec anywhere: the shell is the mission's, whichever mission it is. */
function specFree(canvasElement: HTMLElement): boolean {
  return !/\bSpec\b/.test(canvasElement.textContent ?? '')
}

/** Folded, as a Session opens it: the band, its unfold button and the rail's glyphs. */
export const Folded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(panelOf(canvasElement).getBoundingClientRect().width).toBe(BAND)
    await expect(canvas.getByRole('button', { name: 'Unfold the build' })).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'Stage of B-3' })).toBeNull()
    await expect(
      canvas.getByRole('button', { name: 'Check the import' }),
    ).toHaveAccessibleDescription('To review')
    await expect(specFree(canvasElement)).toBe(true)
  },
}

/** Unfolded: the head over the rail beside the stage, a share of the row wide. */
export const Unfolded: Story = {
  args: { defaultFolded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const panel = panelOf(canvasElement)
    const row = panel.parentElement!.getBoundingClientRect().width
    await expect(panel.getBoundingClientRect().width).toBeCloseTo(row * 0.45, 0)
    await expect(canvas.getByRole('heading', { name: 'B-3 · CSV invoice export' })).toBeVisible()
    await expect(canvas.getByRole('navigation', { name: 'Parts of B-3' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Workers' }))
    await expect(canvas.getByRole('region', { name: 'Stage of B-3' })).toHaveTextContent('Workers')
    await expect(specFree(canvasElement)).toBe(true)
  },
}

/** The widths of the chat on every frame an action moves the row through, until it settles. */
async function chatWidths(canvasElement: HTMLElement, action: () => Promise<void>) {
  const panel = panelOf(canvasElement)
  const chat = panel.previousElementSibling!
  const frames: { chat: number; over: boolean }[] = []
  const measure = () => {
    const left = chat.getBoundingClientRect()
    frames.push({ chat: left.width, over: panel.getBoundingClientRect().left < left.right })
  }
  measure()
  let acted = false
  const settled = new Promise<void>((resolve) => {
    let still = 0
    const sample = (): void => {
      const before = frames.at(-1)!.chat
      measure()
      still = acted && frames.at(-1)!.chat === before ? still + 1 : 0
      if (still < 20) requestAnimationFrame(sample)
      else resolve()
    }
    requestAnimationFrame(sample)
  })
  await action()
  acted = true
  await settled
  return frames
}

/**
 * The panel pushes the chat as it unfolds: the chat narrows on every frame through the widths in
 * between, never back up, and the panel never stands over it.
 */
export const PushesTheChat: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const frames = await chatWidths(canvasElement, () =>
      userEvent.click(canvas.getByRole('button', { name: 'Unfold the build' })),
    )
    const widths = frames.map((frame) => frame.chat)
    const full = widths[0]!
    const narrowest = widths.at(-1)!
    await expect(narrowest).toBeLessThan(full)
    await expect(widths).toEqual(widths.toSorted((a, b) => b - a))
    // How many frames play this spring is the runner's frame rate, not the product's — a loaded
    // Chromium gives two or three. A row of widths in between is the claim; their count is not.
    await expect(
      widths.filter((width) => width < full && width > narrowest).length,
    ).toBeGreaterThan(0)
    await expect(frames.filter((frame) => frame.over)).toEqual([])
  },
}

/**
 * Folded by the hand, the panel stays folded when the agent starts on something; unfolded by the
 * hand, it shows what the agent works on, the keyboard on its row.
 */
export const HandFoldWins: Story = {
  args: { defaultFolded: false },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Fold the build' }))
    await expect(args.onFoldChange).toHaveBeenLastCalledWith(true)
    await waitFor(() => expect(panelOf(canvasElement).getBoundingClientRect().width).toBe(BAND))
    // The fold button is gone with the head: the keyboard is on the band's unfold button.
    await expect(canvas.getByRole('button', { name: 'Unfold the build' })).toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: 'Let the agent start the ledger' }))
    await expect(
      canvas.getByRole('button', { name: 'Write the ledger' }),
    ).toHaveAccessibleDescription('The agent is working on this')
    await expect(args.onFoldChange).toHaveBeenCalledTimes(1)
    await expect(canvas.queryByRole('region', { name: 'Stage of B-3' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Unfold the build' }))
    await expect(args.onFoldChange).toHaveBeenLastCalledWith(false)
    await expect(await canvas.findByRole('region', { name: 'Stage of B-3' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Parse the file' })).toHaveFocus()
    await expect(specFree(canvasElement)).toBe(true)
  },
}

/** Folded, not by the hand: the agent starting on something unfolds the panel onto it. */
export const AgentUnfolds: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Let the agent start the ledger' }))
    await expect(args.onFoldChange).toHaveBeenCalledWith(false)
    const stage = await canvas.findByRole('region', { name: 'Stage of B-3' })
    await expect(stage).toHaveTextContent('Write the ledger')
    await expect(canvas.getByRole('button', { name: 'Write the ledger' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  },
}

/**
 * Narrow: the width the chat unfolds to beside a build (D10-12), a smaller share of the row, so
 * the build at the centre keeps the larger part.
 */
export const Narrow: Story = {
  args: { defaultFolded: false, width: 'narrow' },
  play: async ({ canvasElement }) => {
    const panel = panelOf(canvasElement)
    const row = panel.parentElement!.getBoundingClientRect().width
    await expect(panel.getBoundingClientRect().width).toBeCloseTo(row * 0.3, 0)
  },
}

/**
 * Folded by the page: the page folding it is a hand folding it — it holds against the agent —
 * and the band unfolds it as it always does, which the page is told.
 */
export const FoldedByThePage: Story = {
  args: { defaultFolded: false },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Fold it from the page' }))
    await waitFor(() => expect(panelOf(canvasElement).getBoundingClientRect().width).toBe(BAND))
    await expect(args.onFoldChange).toHaveBeenLastCalledWith(true)
    await userEvent.click(canvas.getByRole('button', { name: 'Let the agent start the ledger' }))
    await expect(canvas.queryByRole('region', { name: 'Stage of B-3' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Unfold the build' }))
    await expect(args.onFoldChange).toHaveBeenLastCalledWith(false)
    await expect(await canvas.findByRole('region', { name: 'Stage of B-3' })).toBeVisible()
  },
}
