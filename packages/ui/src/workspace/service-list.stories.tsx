import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import type { ServiceLine } from './services-model.ts'
import { ServiceList } from './service-list.tsx'

/**
 * The services of a Workspace, and of the Project when several Workspaces run (D8-08, D8-09,
 * D8-10).
 *
 * `dev` is the front's development server, scoped to the Workspace: `login-form` and `main` each
 * run their own. `auth` is scoped to the Project: one instance, in `main`, for every Workspace.
 */
const DEV_LOGIN_FORM: ServiceLine = {
  id: 'run-dev-login-form',
  name: 'dev',
  workspace: 'login-form',
  folder: '/home/someone/.hemera/workspaces/atlas/login-form/sources/front',
  scope: 'workspace',
  state: 'running',
  url: 'http://localhost:3001',
  readiness: 'starting',
  startedBy: 'agent',
}

const DEV_MAIN: ServiceLine = {
  id: 'run-dev-main',
  name: 'dev',
  workspace: 'main',
  folder: '/home/someone/Projects/atlas/sources/front',
  scope: 'workspace',
  state: 'running',
  url: 'http://localhost:3000',
  readiness: 'ready',
  startedBy: 'user',
}

const AUTH: ServiceLine = {
  id: 'run-auth',
  name: 'auth',
  workspace: 'main',
  folder: '/home/someone/Projects/atlas/sources/auth',
  scope: 'project',
  state: 'running',
  url: 'http://auth.localhost:1355',
  readiness: 'ready',
  portless: true,
  startedBy: 'agent',
}

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Surfaces/Workspace/Services',
  component: ServiceList,
  parameters: { layout: 'padded' },
  args: {
    services: [DEV_LOGIN_FORM],
    onStop: fn(),
    onOpenUrl: fn(),
  },
  argTypes: {
    services: {
      control: 'object',
      description: 'The serve runs of the Workspace, or of the Project, whoever started them.',
    },
    onStop: { control: false, description: 'Stops the chosen instance, and only that one.' },
    onOpenUrl: { control: false, description: 'Opens an address that answered.' },
    className: { control: false, description: 'Where the list sits; never how it looks.' },
  },
} satisfies Meta<typeof ServiceList>

export default meta

type Story = StoryObj<typeof meta>

type PlayContext = Parameters<NonNullable<Story['play']>>[0]

/** The row of the service named `name` running in `workspace`, to query inside. */
function rowOf(canvasElement: HTMLElement, name: string, workspace: string) {
  const canvas = within(canvasElement)
  const stop = canvas.queryByRole('button', { name: `Stop ${name} in ${workspace}` })
  const row = (stop ?? canvas.getAllByText(name)[0]!).closest('li')!
  return within(row)
}

// Scenario: "A URL is ready only after it answers"
async function aUrlIsReadyOnlyAfterItAnswers({ canvasElement, args }: PlayContext) {
  const canvas = within(canvasElement)
  const [service] = args.services
  const url = service!.url!
  await expect(canvas.getByText(url)).toBeVisible()
  if (service!.readiness === 'ready') {
    await expect(canvas.getByText('ready')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: url }))
    await expect(args.onOpenUrl).toHaveBeenCalledWith(url)
  } else {
    await expect(canvas.getByText('starting')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: url })).toBeNull()
  }
}

/** The address is published and has not answered yet: text, not a link, and `starting`. */
export const Starting: Story = {
  play: aUrlIsReadyOnlyAfterItAnswers,
}

/** The address answered: it is a link now, and `ready`. */
export const Ready: Story = {
  args: { services: [{ ...DEV_LOGIN_FORM, readiness: 'ready' }] },
  play: aUrlIsReadyOnlyAfterItAnswers,
}

/** A minute without an answer: still starting, and the list says so rather than giving up. */
export const Unanswered: Story = {
  args: { services: [{ ...DEV_LOGIN_FORM, readiness: 'unanswered' }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('No answer after a minute; still starting')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'http://localhost:3001' })).toBeNull()
  },
}

// Scenario: "A port conflict names its holder"
async function aPortConflictNamesItsHolder({ canvasElement }: PlayContext) {
  const row = rowOf(canvasElement, 'dev', 'login-form')
  await expect(row.getByText('Port 3000 is held by dev in main')).toBeVisible()
  // And the holder says it too, naming the run that came second (Decided 12).
  const holder = rowOf(canvasElement, 'dev', 'main')
  await expect(holder.getByText('Port 3000 is also published by dev in login-form')).toBeVisible()
}

/**
 * `login-form` published the port `main` already holds: its row names the holder, and the
 * holder's row names it.
 */
export const PortConflict: Story = {
  args: {
    services: [
      { ...DEV_MAIN, heldAgainst: [{ port: 3000, run: 'dev', workspace: 'login-form' }] },
      {
        ...DEV_LOGIN_FORM,
        url: 'http://localhost:3000',
        portConflict: { port: 3000, holderRun: 'dev', holderWorkspace: 'main' },
      },
    ],
  },
  play: aPortConflictNamesItsHolder,
}

const NO_PORTLESS = 'portless was not found on the PATH'

// Scenario: "Portless is refused when it is not installed"
async function portlessIsRefusedWhenItIsNotInstalled({ canvasElement }: PlayContext) {
  const auth = rowOf(canvasElement, 'auth', 'main')
  await expect(auth.getByText(NO_PORTLESS)).toBeVisible()
  await expect(auth.getByText('Failed')).toBeVisible()
  await expect(auth.queryByRole('button', { name: /^Stop/ })).toBeNull()
}

/**
 * Two launches that did not hold: the conflict found after the fact — the process ended on
 * "address already in use" — and a Portless command refused because `portless` is missing.
 */
export const Failed: Story = {
  args: {
    services: [
      {
        ...DEV_LOGIN_FORM,
        state: 'failed',
        url: undefined,
        readiness: undefined,
        message: 'Error: listen EADDRINUSE: address already in use :::3000',
        portConflict: { port: 3000, holderRun: 'dev', holderWorkspace: 'main' },
      },
      { ...AUTH, state: 'failed', url: undefined, readiness: undefined, message: NO_PORTLESS },
    ],
  },
  play: async (context) => {
    const dev = rowOf(context.canvasElement, 'dev', 'login-form')
    await expect(dev.getByText('Failed')).toBeVisible()
    await expect(
      dev.getByText('Error: listen EADDRINUSE: address already in use :::3000'),
    ).toBeVisible()
    await expect(dev.queryByRole('button', { name: /^Stop/ })).toBeNull()
    await portlessIsRefusedWhenItIsNotInstalled(context)
  },
}

// Scenario: "Two Workspaces run the same command as two instances"
async function twoWorkspacesRunTheSameCommandAsTwoInstances({ canvasElement }: PlayContext) {
  const canvas = within(canvasElement)
  await expect(canvas.getAllByText('dev')).toHaveLength(2)
  await expect(canvas.getByText(DEV_LOGIN_FORM.folder)).toBeVisible()
  await expect(canvas.getByText(DEV_MAIN.folder)).toBeVisible()
}

// Scenario: "Stopping one instance leaves the other running"
async function stoppingOneInstanceLeavesTheOtherRunning({ canvasElement, args }: PlayContext) {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: 'Stop dev in login-form' }))
  await expect(args.onStop).toHaveBeenCalledTimes(1)
  await expect(args.onStop).toHaveBeenCalledWith(DEV_LOGIN_FORM.id)
}

/** `dev` in `login-form` and `dev` in `main`: two instances, two folders, two Stops. */
export const TwoInstances: Story = {
  args: { services: [DEV_LOGIN_FORM, DEV_MAIN] },
  play: async (context) => {
    await twoWorkspacesRunTheSameCommandAsTwoInstances(context)
    await stoppingOneInstanceLeavesTheOtherRunning(context)
  },
}

// Scenario: "A Project-scoped service is one instance for all"
async function aProjectScopedServiceIsOneInstanceForAll({ canvasElement }: PlayContext) {
  const canvas = within(canvasElement)
  await expect(canvas.getAllByRole('listitem')).toHaveLength(1)
  const row = rowOf(canvasElement, 'auth', 'main')
  await expect(row.getByText('main')).toBeVisible()
  await expect(row.getByText('project')).toBeVisible()
  await expect(row.getByText('via portless')).toBeVisible()
}

/** `auth` is the Project's: one instance, in `main`, whichever Workspace asked for it. */
export const ProjectScoped: Story = {
  args: { services: [AUTH] },
  play: aProjectScopedServiceIsOneInstanceForAll,
}

/** Nothing running: the list says so in a sentence. */
export const Empty: Story = {
  args: { services: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('No service is running. A serve command shows here once it starts.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('list')).toBeNull()
  },
}

/** The list by the keyboard: each row's controls in reading order, the link before its Stop. */
export const Keyboard: Story = {
  args: { services: [DEV_MAIN, DEV_LOGIN_FORM] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    await expect(document.activeElement).toBe(canvas.getByRole('button', { name: DEV_MAIN.url! }))
    await userEvent.tab()
    await expect(document.activeElement).toBe(
      canvas.getByRole('button', { name: 'Stop dev in main' }),
    )
    await userEvent.tab()
    // `login-form`'s address is still starting: text, so nothing to stop on before its Stop.
    await expect(document.activeElement).toBe(
      canvas.getByRole('button', { name: 'Stop dev in login-form' }),
    )
    await userEvent.keyboard('{Enter}')
    await expect(args.onStop).toHaveBeenCalledWith(DEV_LOGIN_FORM.id)
  },
}
