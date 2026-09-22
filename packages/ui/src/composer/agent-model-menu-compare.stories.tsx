import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { AGENTS, ARG_TYPES, Controlled, panelBox } from './agent-model-menu-fixtures.tsx'
import { AgentModelMenuPalette } from './agent-model-menu-palette.tsx'
import { AgentModelMenuPanes } from './agent-model-menu-panes.tsx'
import type { AgentModelMenuProps } from './agent-model-menu-shared.tsx'
import { AgentModelMenuStages } from './agent-model-menu-stages.tsx'

/** What every candidate is handed: the same machine, and its own copy of what was answered. */
const OFFER: AgentModelMenuProps = {
  agents: AGENTS,
  agent: null,
  onAgentChange: fn(),
  models: [],
  model: null,
  onModelChange: fn(),
  efforts: [],
  effort: null,
  onEffortChange: fn(),
  modes: [],
  mode: null,
  onModeChange: fn(),
}

/**
 * The three candidates for the universal model picker, on one canvas and on the same machine.
 *
 * A — **the stages**: one list at a time, the agents then the models, a back arrow, the narrow
 * panel. B — **the panes**: both lists at once in a wider panel, the effort and the modes in a
 * band across the foot, no way back because nothing was left. C — **the palette**: one field
 * over one list of agent-and-model rows, no stage at all.
 *
 * They take the same props and are handed the same agents, so what is being compared is the
 * panel and nothing else. Open them in turn: the question is how many moves each takes to name
 * an agent, a model, an effort and a mode, and what each of them costs in width.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/AgentModelMenu/Compare',
  component: AgentModelMenuStages,
  parameters: { layout: 'padded' },
  args: OFFER,
  argTypes: ARG_TYPES,
} satisfies Meta<typeof AgentModelMenuStages>

export default meta
type Story = StoryObj<typeof meta>

const ROW = 'flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0'

const NAME = 'flex min-w-0 flex-col'

const TITLE = 'text-sm font-medium'

const SAID = 'text-xs text-muted-foreground'

function Candidate({
  name,
  said,
  children,
}: {
  name: string
  said: string
  children: ReactNode
}): ReactNode {
  return (
    <div className={ROW}>
      <span className={NAME}>
        <span className={TITLE}>{name}</span>
        <span className={SAID}>{said}</span>
      </span>
      {children}
    </div>
  )
}

/**
 * The three, side by side, each with its own answers: pick an agent in one and the other two
 * are untouched, which is what makes them comparable rather than three views of one state.
 */
export const SideBySide: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex w-full flex-col">
      <Candidate name="A · Stages" said="The agents, then the models. One narrow panel.">
        <Controlled {...OFFER} render={(props) => <AgentModelMenuStages {...props} />} />
      </Candidate>
      <Candidate name="B · Panes" said="Both lists at once, and a band under them.">
        <Controlled {...OFFER} render={(props) => <AgentModelMenuPanes {...props} />} />
      </Candidate>
      <Candidate name="C · Palette" said="One field over every agent and every model.">
        <Controlled {...OFFER} render={(props) => <AgentModelMenuPalette {...props} />} />
      </Candidate>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [stages, panes, palette] = canvas.getAllByRole('button', { name: 'Choose an agent' })

    // A: the agents are a stage of their own.
    await userEvent.click(stages!)
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Agents' })).toBeVisible()
    })
    const narrow = panelBox()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    // B: the agents are a column, and the panel is wider for it.
    await userEvent.click(panes!)
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Agents' })).toBeVisible()
    })
    await expect(panelBox().width).toBeGreaterThan(narrow.width)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    // C: there is no list of agents at all — there is one list, and the agents are rows of it.
    await userEvent.click(palette!)
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Agents and their models' })).toBeVisible()
    })
    await expect(screen.queryByRole('listbox', { name: 'Agents' })).toBeNull()
    await expect(panelBox().width).toBeCloseTo(narrow.width, 1)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  },
}
