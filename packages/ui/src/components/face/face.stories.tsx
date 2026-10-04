import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../button/button.tsx'
import { FACE_SIZES, Face } from './face.tsx'
import { TONE_CLASSES } from './pose.ts'
import { EXPRESSIONS, FACE_STATES, type FaceState } from './states.ts'

/**
 * Hemera's face: a small mascot whose expression, motion and colour say what an agent is doing.
 *
 * Two eyes and a mouth, each one stroke of three points; every state a way of placing them, of
 * moving the head and of blinking. Inside a state the face lives on dice drawn from its seed, so
 * it never loops and the same seed tells the same story. Between two states it never cuts: every
 * change is a motion from wherever the face is — eyes, mouth, head and colour together.
 *
 * The runner of these stories asks for less movement, so each story is played on the still
 * expression a reader asking for that sees. The life and the changes are checked one frame at a
 * time by the face's own tests, and watched here in the catalogue.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/Face',
  component: Face,
  args: { state: 'thinking', size: 'lg', seed: 1 },
  argTypes: {
    state: {
      control: 'select',
      options: FACE_STATES,
      description: 'What the agent is doing; every change of it is played, never cut.',
    },
    size: {
      control: 'inline-radio',
      options: FACE_SIZES,
      description: 'From an icon button, where the face simplifies, to the hero of a page.',
      table: { defaultValue: { summary: 'md' } },
    },
    seed: {
      control: 'number',
      description: 'The same seed and the same changes tell the same story.',
    },
    mouth: {
      control: 'boolean',
      description: 'Whether the mouth is drawn; it is, at every size, unless turned off.',
      table: { defaultValue: { summary: 'true' } },
    },
    legend: {
      control: 'boolean',
      description: 'Whether the state in words is a tooltip on the face.',
      table: { defaultValue: { summary: 'false' } },
    },
    label: {
      control: 'text',
      description: "What the face says in words; the state's own words when left out.",
    },
    className: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Face>

export default meta
type Story = StoryObj<typeof meta>

/** The drawn strokes of a face's first layer, read off the page: what a frame changed, or not. */
function strokesOf(face: Element): string[] {
  return [...face.querySelectorAll('[data-face-part^="0-"]')].map(
    (part) => `${part.getAttribute('d') ?? ''} ${part.getAttribute('stroke-width') ?? ''}`,
  )
}

/** The tones a face is drawn in right now: the uses it shows. */
function tonesOf(face: Element): string[] {
  return [...face.querySelectorAll('use:not([display="none"])')].map(
    (use) => use.getAttribute('class') ?? '',
  )
}

/** Waits for the next frames, as many as asked. */
function frames(count: number): Promise<void> {
  return new Promise((settle) => {
    const look = (left: number): void => {
      if (left === 0) settle()
      else requestAnimationFrame(() => look(left - 1))
    }
    look(count)
  })
}

/**
 * What every state's story checks: the face says the state in its own words, wears that state's
 * tone and no other, and holds still.
 */
function posed(state: FaceState): Story {
  const { label, tone } = EXPRESSIONS[state]
  return {
    args: { state },
    play: async ({ canvasElement }) => {
      const face = within(canvasElement).getByRole('img', { name: label })
      expect(face).toHaveAttribute('data-state', state)
      await waitFor(() => {
        expect(tonesOf(face)).toEqual([TONE_CLASSES[tone]])
      })
      const before = strokesOf(face)
      expect(before.every((stroke) => stroke.trim() !== '')).toBe(true)
      await frames(10)
      expect(strokesOf(face)).toEqual(before)
    },
  }
}

/**
 * Loading: no face yet, three dots going round in whatever colour the face sits in — the loading
 * indicator itself, until the face it becomes is known.
 */
export const Loading: Story = posed('loading')

/** Thinking: heavy-lidded, looking up and away, working something out. */
export const Thinking: Story = posed('thinking')

/** Reading: eyes flattened on the page, a line at a time. */
export const Reading: Story = posed('reading')

/** Writing: flattened and lidded, looking down, following the caret. */
export const Writing: Story = posed('writing')

/** Running a command: two terminal cursors on the output, watching it scroll. */
export const Running: Story = posed('running')

/** Checking what was built: one eye narrowed on the work, going down the list. */
export const Checking: Story = posed('checking')

/** Waiting for an answer: two cursors stood up, straight at you. */
export const Question: Story = posed('question')

/** Waiting for a permission: eyes wide open, looking up from under a lowered head. */
export const Permission: Story = posed('permission')

/** Blocked: `>_<`, eyes screwed shut against what will not give. */
export const Blocked: Story = posed('blocked')

/** Done: creased, smiling, nodding now and then. */
export const Done: Story = posed('done')

/** Something went wrong: a glare and a frown, and it does not blink. */
export const Error: Story = posed('error')

/** Nothing running: eyes closed, breathing, yawning now and then. */
export const Asleep: Story = posed('asleep')

/**
 * Every size, from an icon button to the hero of a page, and an icon without its mouth. Small,
 * the face simplifies rather than blurs: heavier strokes, gestures that travel further.
 */
export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-end gap-6">
      {FACE_SIZES.map((size) => (
        <span key={size} className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
          <Face state="done" size={size} seed={3} label={`Done, ${size}`} />
          {size}
        </span>
      ))}
      <span className="flex flex-col items-center gap-2 text-xs text-muted-foreground">
        <Face state="done" size="icon" seed={3} mouth={false} label="Done, no mouth" />
        no mouth
      </span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const icon = canvas.getByRole('img', { name: 'Done, icon' })
    const hero = canvas.getByRole('img', { name: 'Done, hero' })
    const bare = canvas.getByRole('img', { name: 'Done, no mouth' })
    // The mouth is drawn at every size, down to an icon, and left out only when asked.
    await waitFor(() => {
      expect(icon.querySelector('[data-face-part="0-mouth"]')).not.toHaveAttribute('display')
      expect(hero.querySelector('[data-face-part="0-mouth"]')).not.toHaveAttribute('display')
      expect(bare.querySelector('[data-face-part="0-mouth"]')).toHaveAttribute('display', 'none')
    })
    const widths = FACE_SIZES.map(
      (size) => canvas.getByRole('img', { name: `Done, ${size}` }).getBoundingClientRect().width,
    )
    expect(widths.every((width) => width > 0)).toBe(true)
    expect(new Set(widths).size).toBe(FACE_SIZES.length)
    expect(widths).toEqual([...widths].sort((a, b) => a - b))
  },
}

/**
 * The face inside a line of text, at the size of an icon, set there by `inline` and no class of the caller. Small, it is drawn larger than its box
 * and past it, and the box is set in the line rather than added to it: the line keeps the height
 * it has without a face, and the face still reads.
 */
export const InText: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex max-w-sm flex-col gap-3 text-sm">
      <p>
        <Face state="writing" size="icon" seed={2} inline /> Writing the migration of the api
        repository of Acme, then running its tests.
      </p>
      <p>Writing the migration of the api repository of Acme, then running its tests.</p>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const [withFace, without] = [...canvasElement.querySelectorAll('p')]
    // The face takes no more room than its box: the line is as tall as the one without it.
    expect(withFace!.getBoundingClientRect().height).toBe(without!.getBoundingClientRect().height)
  },
}

/** The state in words is a tooltip on the face, reached by the hand and by the keyboard alike. */
export const Focused: Story = {
  args: { state: 'question', legend: true },
  play: async ({ canvasElement }) => {
    const face = within(canvasElement).getByRole('img', { name: 'Waiting for your answer' })
    await userEvent.tab()
    expect(face).toHaveFocus()
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent(
        'Waiting for your answer',
      )
    })
    await userEvent.tab()
    await waitFor(() => {
      expect(within(document.body).queryByRole('tooltip')).toBeNull()
    })
  },
}

/** The states a face is stepped through by hand. */
const STEPS: readonly FaceState[] = ['thinking', 'question', 'done']

/** A face held in one state, beside one stepped through a few states by hand. */
function Stepper(): ReactNode {
  const [step, setStep] = useState(0)
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex gap-6">
        <Face state="thinking" size="lg" seed={2} label="Held" />
        <Face state={STEPS[step % STEPS.length]!} size="lg" seed={2} label="Stepped" />
      </div>
      <Button onClick={() => setStep((was) => was + 1)}>Next state</Button>
    </div>
  )
}

/**
 * For a reader who asked for less movement: still expressions, and a soft cross-fade from one to
 * the next — the face never moves, and never jumps at the reader either.
 *
 * Asked here by the tree, with `MotionConfig reducedMotion="always"`, which the face reads through
 * `useTransition` exactly as it reads the system's own preference.
 */
export const ReducedMotion: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <MotionConfig reducedMotion="always">
      <Stepper />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const held = canvas.getByRole('img', { name: 'Held' })
    const stepped = canvas.getByRole('img', { name: 'Stepped' })
    await waitFor(() => {
      expect(tonesOf(held)).toHaveLength(1)
    })
    const before = strokesOf(held)
    await frames(20)
    // Still: twenty frames on, not one stroke of the face left alone has moved.
    expect(strokesOf(held)).toEqual(before)
    await userEvent.click(canvas.getByRole('button', { name: 'Next state' }))
    // The one stepped on lands in its new state, a still expression in a single tone of its own;
    // the cross-fade that takes it there is read frame by frame in the face's own tests.
    await waitFor(() => {
      expect(stepped).toHaveAttribute('data-state', 'question')
      expect(tonesOf(stepped)).toEqual([TONE_CLASSES[EXPRESSIONS.question.tone]])
    })
  },
}

/** How long a cell of the grid holds each end of its change, in milliseconds. */
const HOLD = { from: 1400, to: 2200 } as const

/** One change played over and over: `from`, then `to`, then `from` again as a new face. */
function Replay({ from, to }: { from: FaceState; to: FaceState }): ReactNode {
  const [round, setRound] = useState(0)
  const [state, setState] = useState(from)
  useEffect(() => {
    setState(from)
    const change = setTimeout(() => setState(to), HOLD.from)
    const again = setTimeout(() => setRound((was) => was + 1), HOLD.from + HOLD.to)
    return () => {
      clearTimeout(change)
      clearTimeout(again)
    }
  }, [from, to, round])
  return (
    <Face
      key={round}
      state={state}
      size="md"
      seed={3}
      label={`${EXPRESSIONS[from].label} to ${EXPRESSIONS[to].label}`}
    />
  )
}

/**
 * Every change between two states, played in a grid: the row is where the face comes from, the
 * column where it goes. Each cell holds the first state, changes, holds the second, and starts
 * over. The diagonal is the state itself.
 */
export const Transitions: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid grid-cols-13 gap-1 text-xs text-muted-foreground">
      <span />
      {FACE_STATES.map((to) => (
        <span key={to} className="truncate text-center">
          {to}
        </span>
      ))}
      {FACE_STATES.map((from) => (
        <div key={from} className="contents">
          <span className="flex items-center">{from}</span>
          {FACE_STATES.map((to) => (
            <span key={to} className="flex justify-center p-1">
              {from === to ? (
                <Face state={from} size="md" seed={3} />
              ) : (
                <Replay from={from} to={to} />
              )}
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pairs = FACE_STATES.length * (FACE_STATES.length - 1)
    expect(canvas.getAllByRole('img', { name: / to / })).toHaveLength(pairs)
  },
}

/** A story of changes, some of them arriving before the one before has finished. */
interface Script {
  readonly title: string
  readonly steps: readonly { readonly state: FaceState; readonly after: number }[]
}

const SCRIPTS: readonly Script[] = [
  {
    title: 'Done, interrupted by an error',
    steps: [
      { state: 'writing', after: 0 },
      { state: 'done', after: 1600 },
      { state: 'error', after: 380 },
    ],
  },
  {
    title: 'A question answered before it was asked',
    steps: [
      { state: 'thinking', after: 0 },
      { state: 'question', after: 1600 },
      { state: 'thinking', after: 260 },
    ],
  },
  {
    title: 'Woken, and at once asked for leave',
    steps: [
      { state: 'asleep', after: 0 },
      { state: 'running', after: 1600 },
      { state: 'permission', after: 600 },
    ],
  },
  {
    title: 'Four kinds of work in a second',
    steps: [
      { state: 'reading', after: 0 },
      { state: 'writing', after: 1600 },
      { state: 'running', after: 250 },
      { state: 'checking', after: 250 },
      { state: 'reading', after: 250 },
    ],
  },
]

/** A script played over and over, as one face. */
function Scripted({ script }: { script: Script }): ReactNode {
  const [round, setRound] = useState(0)
  const [state, setState] = useState(script.steps[0]!.state)
  useEffect(() => {
    let total = 0
    const timers = script.steps.map((step) => {
      total += step.after
      return setTimeout(() => setState(step.state), total)
    })
    timers.push(setTimeout(() => setRound((was) => was + 1), total + 2400))
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [script, round])
  return <Face key={round} state={state} size="lg" seed={5} label={script.title} />
}

/**
 * A change that arrives before the last one is over is taken from wherever the face is: the head
 * half-way through its turn, the eyes half-way to their new shape, the colour half-way to its new
 * tone — and nothing snaps.
 */
export const Interrupted: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="grid grid-cols-2 gap-8">
      {SCRIPTS.map((script) => (
        <span
          key={script.title}
          className="flex flex-col items-center gap-2 text-center text-xs text-muted-foreground"
        >
          <Scripted script={script} />
          {script.title}
        </span>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const script of SCRIPTS) {
      expect(canvas.getByRole('img', { name: script.title })).toBeVisible()
    }
  },
}

/**
 * The window while Hemera starts: its face at the size of a hero, awake and thinking, in the
 * middle of the window — never the three dots of a spinner. The words are said to whatever reads
 * the page, and on the face's tooltip.
 */
export const Starting: Story = {
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  render: () => (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4">
      <Face state="thinking" size="hero" seed={4} label="Starting Hemera" />
      <p className="text-sm text-muted-foreground">Starting Hemera</p>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const face = within(canvasElement).getByRole('img', { name: 'Starting Hemera' })
    expect(face.getBoundingClientRect().width).toBe(128)
    // A drawn face — two eyes and a mouth, each a stroke with a length — and not loading dots.
    await waitFor(() => {
      expect(strokesOf(face).every((stroke) => stroke.trim() !== '')).toBe(true)
    })
    expect(face).toHaveAttribute('data-state', 'thinking')
  },
}
