import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { findOpen } from '../../overlay-play.ts'
import {
  APPROVAL_AFTER_SHIP,
  APPROVAL_AFTER_SHIP_RULES,
  BUMP_WITHOUT_UPSTREAM,
  CLI_CHECKING,
  CLI_MISSING,
  CLI_SIGNED_OUT,
  CLI_UNREACHABLE,
  CYCLE,
  CYCLE_RULES,
  DENSE_RULES,
  EVERY_REFUSAL,
  EVERY_STEP_RULES,
  FORCED,
  FORGE_CANNOT,
  LONG_RULES,
  MERGE_WITHOUT_PR,
  PLAIN_RULES,
  PR_WITHOUT_PUSH,
  RULES,
  pushedIn,
} from './delivery-fixtures.ts'
import {
  CATALOGUE,
  type DeliveryRefusals,
  type DeliveryRules,
  STEP_WORDS,
} from './delivery-model.ts'
import { DeliveryPage as Page } from './delivery-page.tsx'
import { STALE } from './project-settings-fixtures.ts'

const body = () => within(document.body)

/**
 * The delivery rules of a Project's settings: what happens from the first push to Done, in its
 * three moments — the pull requests before Ship, the waves after it, and the End. One line per
 * thing; a repository unfolds into its recipe, a line opens its dialog, and a rule the engine
 * refuses is said in words at its place.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Delivery rules',
  component: Page,
  parameters: { layout: 'fullscreen' },
  args: {
    rules: RULES,
    onSave: fn(),
    onCopy: fn(),
    onCheckAgain: fn(),
  },
  argTypes: {
    rules: { table: { disable: true } },
    refusals: { table: { disable: true } },
    form: { table: { disable: true } },
  },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

/** Acme as it is lived in: the three moments, shared in the first wave, api and web in the second. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: /^Pull requests/ })).toBeVisible()
    expect(canvas.getByRole('heading', { name: /^Waves/ })).toBeVisible()
    expect(canvas.getByRole('heading', { name: /^End/ })).toBeVisible()
    expect(
      within(canvas.getByRole('list', { name: 'Wave 1' })).getAllByRole('listitem'),
    ).toHaveLength(1)
    expect(
      within(canvas.getByRole('list', { name: 'Wave 2' })).getAllByRole('listitem'),
    ).toHaveLength(2)
    // Folded by default: a repository is one line until it is opened.
    const api = canvas.getByRole('button', { name: /^api, Application, 4 changes, after shared/ })
    expect(api).toHaveAttribute('aria-expanded', 'false')
    expect(canvas.queryByRole('list', { name: 'Steps of api' })).toBeNull()
    // Who commits is no setting of its own: committing is a step of the recipes.
    expect(canvas.queryByRole('button', { name: /^Who commits/ })).toBeNull()
  },
}

/** A repository unfolded: its preset, its remote and base, its forge, and its effective recipe. */
export const RepositoryRecipe: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^api, Application/ }))
    const steps = await canvas.findByRole('list', { name: 'Steps of api' })
    expect(
      within(steps).getByRole('button', { name: /^Merge, rebase, changed here/ }),
    ).toBeVisible()
    expect(
      within(steps).getByRole('button', {
        name: /^Command, db-migrate-check, added here, may write to the network/,
      }),
    ).toBeVisible()
    expect(
      within(steps).getByRole('button', {
        name: /^Action on the remote, deploy-staging.yml, added here, waits for your click/,
      }),
    ).toBeVisible()
    // Each moment holds its own steps: an agent commits after each task; when Review starts,
    // Hemera commits, then pushes and opens the pull request.
    const tasks = canvas.getByRole('list', { name: 'Steps of api after each task' })
    expect(
      within(tasks).getByRole('button', {
        name: /^An agent commits, under the permission rules, added here, may write to the network/,
      }),
    ).toBeVisible()
    const review = canvas.getByRole('list', { name: 'Steps of api in Review' })
    expect(
      within(review)
        .getAllByRole('button')
        .map((one) => one.textContent),
    ).toEqual([
      expect.stringMatching(/^Hemera commits/),
      expect.stringMatching(/^Push/),
      expect.stringMatching(/^Pull request/),
    ])
    expect(canvas.getByRole('combobox', { name: 'Preset of api' })).toHaveTextContent('Application')
    await userEvent.click(canvas.getByRole('button', { name: /^api, Application/ }))
    await waitFor(() => {
      expect(canvas.queryByRole('list', { name: 'Steps of api' })).toBeNull()
    })
  },
}

/** A step left out here: struck, quiet, and Put back brings it back from the preset. */
export const StepLeftOut: Story = {
  args: { open: ['web'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: 'Steps of web' })
    expect(
      within(steps).getByText(/^CI, checks of the pushed commit, left out here/),
    ).toBeInTheDocument()
    await userEvent.click(within(steps).getByRole('button', { name: 'Put back CI' }))
    expect(
      await within(steps).findByRole('button', { name: /^CI, checks of the pushed commit$/ }),
    ).toBeVisible()
  },
}

/** Each preset's own recipe: the Library publishes a version, the Application does not, Local merges here. */
export const Presets: Story = {
  args: { rules: PLAIN_RULES, open: ['shared', 'api'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      within(canvas.getByRole('list', { name: 'Steps of shared' })).getByRole('button', {
        name: /^Published version, @acme\/shared/,
      }),
    ).toBeVisible()
    expect(
      within(canvas.getByRole('list', { name: 'Steps of api' })).queryByRole('button', {
        name: /^Published version/,
      }),
    ).toBeNull()
    await userEvent.click(canvas.getByRole('combobox', { name: 'Preset of api' }))
    await userEvent.click(await body().findByRole('option', { name: 'Local' }))
    expect(
      await within(canvas.getByRole('list', { name: 'Steps of api' })).findByRole('button', {
        name: /^Merge locally, into main/,
      }),
    ).toBeVisible()
    expect(canvas.getByRole('button', { name: /^api, Local, as the preset/ })).toBeVisible()
  },
}

/** Every kind of step in one recipe, across its moments, the network and click marks in their columns. */
export const EveryStepType: Story = {
  args: { rules: EVERY_STEP_RULES, open: ['api'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tasks = canvas.getByRole('list', { name: 'Steps of api after each task' })
    const review = canvas.getByRole('list', { name: 'Steps of api in Review' })
    const steps = canvas.getByRole('list', { name: 'Steps of api' })
    const named = (list: HTMLElement, names: readonly string[]) => {
      for (const name of names)
        expect(within(list).getByRole('button', { name: new RegExp(`^${name},`) })).toBeVisible()
    }
    named(tasks, ['Hemera commits', 'An agent commits'])
    named(review, ['I commit myself', 'Hemera commits', 'Push', 'Pull request'])
    named(steps, [
      'Bump',
      'Merge',
      'CI',
      'Action on the remote',
      'Published version',
      'Command',
      'Agent',
      'Confirm',
      'Stop the mission’s services',
    ])
    expect(canvas.getAllByRole('button', { name: /may write to the network/ })).toHaveLength(3)
  },
}

/** A moment with nothing in it: said in its place, and open to any step of the catalogue. */
export const EmptyMoment: Story = {
  args: { rules: PLAIN_RULES, open: ['shared'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tasks = canvas.getByRole('list', { name: 'Steps of shared after each task' })
    expect(within(tasks).getByText(/^Nothing after each task/)).toBeVisible()
    expect(within(tasks).queryByRole('button')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Add a step to shared' }))
    const dialog = await findOpen(body(), 'dialog', { name: 'New step · shared' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'When' }))
    await userEvent.click(await body().findByRole('option', { name: 'After each task' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('combobox', { name: 'After' })).toHaveTextContent('First')
    })
  },
}

function stepStory(id: string, check: (dialog: HTMLElement) => Promise<void>): Story {
  return {
    args: { rules: EVERY_STEP_RULES, open: ['api'], form: { kind: 'step', repository: 'api', id } },
    play: async () => {
      const dialog = await findOpen(body(), 'dialog')
      expect(within(dialog).getByRole('combobox', { name: 'Starts' })).toBeVisible()
      await check(dialog)
    },
  }
}

/** Bump: by a catalogue command or by the agent. */
export const StepBump = stepStory('bump', async (dialog) => {
  expect(within(dialog).getByRole('combobox', { name: 'Moved by' })).toHaveTextContent(
    'A catalogue command',
  )
  expect(within(dialog).getByRole('combobox', { name: 'Command' })).toHaveTextContent('bump-deps')
})

/** Merge: squash, a merge commit, or rebase. */
export const StepMerge = stepStory('merge', async (dialog) => {
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Method' }))
  const options = await body().findAllByRole('option')
  expect(options.map((one) => one.textContent)).toEqual(['Squash', 'Merge commit', 'Rebase'])
  await userEvent.keyboard('{Escape}')
})

/** CI: nothing to write but how it starts. */
export const StepCI = stepStory('ci', async (dialog) => {
  expect(within(dialog).getAllByRole('combobox')).toHaveLength(1)
})

/** An action on the remote: the workflow or the pipeline the forge's command line starts. */
export const StepRemoteAction = stepStory('release', async (dialog) => {
  expect(within(dialog).getByRole('textbox', { name: 'Workflow or pipeline' })).toHaveValue(
    'release.yml',
  )
  expect(within(dialog).getByRole('combobox', { name: 'Starts' })).toHaveTextContent(
    'Waits for your click',
  )
})

/** A published version: found by a tag, on a registry, or by your confirmation. */
export const StepPublishedVersion = stepStory('published', async (dialog) => {
  expect(within(dialog).getByRole('textbox', { name: 'Tag pattern' })).toHaveValue('v*')
  await userEvent.click(within(dialog).getByRole('combobox', { name: 'Found by' }))
  await userEvent.click(await body().findByRole('option', { name: 'Your confirmation' }))
  await waitFor(() => {
    expect(within(dialog).queryByRole('textbox', { name: 'Tag pattern' })).toBeNull()
  })
})

/** A command: from the catalogue, and marked as one that may write to the network. */
export const StepCommand = stepStory('notify', async (dialog) => {
  expect(within(dialog).getByRole('combobox', { name: 'Command' })).toHaveTextContent(
    'notify-release',
  )
  expect(within(dialog).getByText(/^May write to the network/)).toBeVisible()
})

/** An agent: its task, and the same mark. */
export const StepAgent = stepStory('changelog', async (dialog) => {
  expect(within(dialog).getByRole('textbox', { name: 'Task' })).toHaveValue(
    'Write the release note of the published version in docs/releases.md',
  )
  expect(within(dialog).getByText(/^May write to the network/)).toBeVisible()
})

/** Hemera commits: with the commit template, nothing else to write. */
export const StepCommitByHemera = stepStory('commit', async (dialog) => {
  expect(dialog).toHaveAccessibleName('Hemera commits · api · When Review starts')
  expect(within(dialog).getAllByRole('combobox')).toHaveLength(1)
  expect(within(dialog).queryByText(/^May write to the network/)).toBeNull()
})

/** I commit myself: Hemera waits for your click, then checks that a new commit is on the branch. */
export const StepCommitByMe = stepStory('own-commit', async (dialog) => {
  expect(dialog).toHaveAccessibleName('I commit myself · api · When Review starts')
  expect(within(dialog).getByRole('combobox', { name: 'Starts' })).toHaveTextContent(
    'Waits for your click',
  )
})

/** An agent commits: an agent's step, so marked as one that may write to the network. */
export const StepCommitByAgent = stepStory('agent-commit', async (dialog) => {
  expect(dialog).toHaveAccessibleName('An agent commits · api · After each task')
  expect(within(dialog).getByText(/^May write to the network/)).toBeVisible()
})

/** Confirm: what you say you did, for what Hemera can neither see nor start. */
export const StepConfirm = stepStory('announce', async (dialog) => {
  expect(within(dialog).getByRole('textbox', { name: 'What you confirm' })).toHaveValue(
    'The release is announced',
  )
  expect(within(dialog).queryByText(/^May write to the network/)).toBeNull()
})

/**
 * A step added to one repository: any kind of the catalogue, committing included, in any moment,
 * after the step it follows there, and how it starts.
 */
export const AddAStep: Story = {
  args: { open: ['shared'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add a step to shared' }))
    const dialog = await findOpen(body(), 'dialog', { name: 'New step · shared' })
    expect(within(dialog).getByRole('combobox', { name: 'Kind' })).toHaveTextContent('Command')
    expect(within(dialog).getByRole('combobox', { name: 'When' })).toHaveTextContent('After Ship')
    expect(within(dialog).getByRole('combobox', { name: 'After' })).toHaveTextContent(
      'Published version',
    )
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'When' }))
    const moments = await body().findAllByRole('option')
    expect(moments.map((one) => one.textContent)).toEqual([
      'After each task',
      'When Review starts',
      'After Ship',
    ])
    await userEvent.click(await body().findByRole('option', { name: 'When Review starts' }))
    await waitFor(() => {
      expect(within(dialog).getByRole('combobox', { name: 'After' })).toHaveTextContent(
        'Pull request',
      )
    })
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Kind' }))
    const kinds = await body().findAllByRole('option')
    expect(kinds.map((one) => one.textContent)).toEqual([
      'Hemera commits',
      'I commit myself',
      'An agent commits',
      'Push',
      'Pull request',
      'Bump',
      'Merge',
      'Merge locally',
      'CI',
      'Action on the remote',
      'Published version',
      'Command',
      'Agent',
      'Confirm',
      'Pull the main checkout',
      'Stop the mission’s services',
      'Remove the worktrees',
      'Remove the Workspace',
    ])
    await userEvent.click(await body().findByRole('option', { name: 'Confirm' }))
    expect(await within(dialog).findByRole('textbox', { name: 'What you confirm' })).toBeVisible()
  },
}

/** Push and the pull requests when Review starts, on their own: the default. */
export const PushInReview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: /^Push and open, When Review starts · on its own/ }),
    )
    const dialog = await findOpen(body(), 'dialog', { name: 'Push and open the pull requests' })
    expect(within(dialog).getByRole('combobox', { name: 'Opens' })).toHaveTextContent(
      'When Review starts',
    )
  },
}

/** Moved into the waves, waiting for a click: the recipes lead with Push and Pull request. */
export const PushInWavesOnAClick: Story = {
  args: {
    rules: {
      ...RULES,
      pullRequests: {
        ...RULES.pullRequests,
        placement: 'waves',
        start: 'click',
        requireApproval: false,
      },
      repositories: pushedIn(RULES.repositories, 'waves'),
    },
    open: ['api'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('button', {
        name: /^Push and open, After Ship, in each wave · waits for your click/,
      }),
    ).toBeVisible()
    const review = canvas.getByRole('list', { name: 'Steps of api in Review' })
    expect(within(review).getByText(/^Nothing when Review starts/)).toBeVisible()
    const steps = canvas.getByRole('list', { name: 'Steps of api' })
    const [commit, push] = within(steps).getAllByRole('button')
    expect(commit).toHaveAccessibleName(/^Hemera commits, with the commit template/)
    expect(push).toHaveAccessibleName(/^Push, origin/)
  },
}

/** A template's dialog: the names offered by the braces, and what ACME-12 reads. */
export const CommitTemplate: Story = {
  args: { form: { kind: 'commit' } },
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Commit message' })
    expect(within(dialog).getByLabelText('Commit message for ACME-12')).toHaveTextContent(
      'ACME-12: Export invoices as CSV',
    )
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Insert a name in Commit message' }),
    )
    const names = await body().findAllByRole('menuitem')
    expect(names.map((one) => one.textContent)).toEqual([
      expect.stringMatching(/^\{key\}/),
      expect.stringMatching(/^\{title\}/),
      expect.stringMatching(/^\{slug\}/),
      expect.stringMatching(/^\{branch\}/),
      expect.stringMatching(/^\{summary\}/),
      expect.stringMatching(/^\{images\}/),
    ])
    await userEvent.click(body().getByRole('menuitem', { name: /^\{slug\}/ }))
    expect(within(dialog).getByRole('textbox', { name: 'Commit message' })).toHaveValue(
      '{key}: {title}{slug}',
    )
  },
}

/** The pull request's body: several lines, {images} among them. */
export const BodyTemplate: Story = {
  args: { form: { kind: 'body' } },
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Pull request body' })
    expect(within(dialog).getByLabelText('Pull request body for ACME-12')).toHaveTextContent(
      /streamed page by page.*!\[The export button\]\(export\.png\).*Refs ACME-12/s,
    )
  },
}

/** A name Hemera does not fill is refused as it is typed, and Save keeps the dialog open. */
export const UnknownVariableRefused: Story = {
  args: { form: { kind: 'title' } },
  play: async ({ args }) => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Pull request title' })
    const field = within(dialog).getByRole('textbox', { name: 'Pull request title' })
    await userEvent.type(field, ' {{ticket}')
    expect(
      await within(dialog).findByText(
        /^\{ticket\} is not a name Hemera fills\. Use \{key\}, \{title\}/,
      ),
    ).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(args.onSave).toHaveBeenCalledWith('title')
    expect(body().getByRole('dialog', { name: 'Pull request title' })).toBeVisible()
  },
}

/** The reviewers: those chosen with their ×, and a search over everyone the forge offers. */
export const Reviewers: Story = {
  args: { form: { kind: 'reviewers' } },
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Reviewers' })
    const chosen = within(dialog).getByRole('list', { name: 'Chosen reviewers' })
    expect(within(chosen).getAllByRole('listitem')).toHaveLength(2)
    // Nothing listed until something is searched: the forge's long list is never scrolled through.
    expect(within(dialog).queryByRole('list', { name: 'Reviewers found' })).toBeNull()
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Add a reviewer' }), 'nak')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Add Wren Nakamura' }))
    expect(within(chosen).getAllByRole('listitem')).toHaveLength(3)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Dana Reyes' }))
    expect(within(chosen).getAllByRole('listitem')).toHaveLength(2)
  },
}

/** A search that finds nobody says so. */
export const ReviewerNotFound: Story = {
  args: { form: { kind: 'reviewers' } },
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Reviewers' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Add a reviewer' }), 'zzz')
    expect(await within(dialog).findByText('Nobody on the forge matches “zzz”.')).toBeVisible()
  },
}

/** Many reviewers: the line names two, and how many more. */
export const ManyReviewers: Story = {
  args: { rules: DENSE_RULES },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('button', { name: 'Reviewers, @acme/web, @acme/api and 12 more' }),
    ).toBeVisible()
  },
}

/** Approvals before Ship, and the drafts read first — off by default. */
export const Approvals: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      canvas.getByRole('checkbox', { name: 'Require team approval before Ship' }),
    ).toBeChecked()
    const drafts = canvas.getByRole('checkbox', { name: /^Review the drafts first/ })
    expect(drafts).not.toBeChecked()
    await userEvent.click(drafts)
    expect(drafts).toBeChecked()
  },
}

/** A repository's remote, base branch and forge, read from the remote. */
export const RemoteAndBase: Story = {
  args: { open: ['api'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Remote, base and forge of api' }))
    const dialog = await findOpen(body(), 'dialog', { name: 'api' })
    expect(within(dialog).getByRole('combobox', { name: 'Remote' })).toHaveTextContent('origin')
    expect(within(dialog).getByRole('combobox', { name: 'Forge' })).toHaveTextContent(
      'GitHub, read from the remote',
    )
    const base = within(dialog).getByRole('textbox', { name: 'Base branch' })
    await userEvent.clear(base)
    await userEvent.type(base, 'release..next')
    expect(await within(dialog).findByText(/is not a branch name Git accepts/)).toBeVisible()
  },
}

/** The forge forced: Bitbucket Data Center on its own host, said on the line and in the dialog. */
export const ForgeForced: Story = {
  args: { rules: FORCED, open: ['api'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Remote, base and forge of api' })
    expect(button).toHaveTextContent('Bitbucket Data Center, forced')
    await userEvent.click(button)
    const dialog = await findOpen(body(), 'dialog', { name: 'api' })
    expect(within(dialog).getByRole('combobox', { name: 'Forge' })).toHaveTextContent(
      'Bitbucket Data Center',
    )
    expect(within(dialog).getByRole('textbox', { name: 'Host' })).toHaveValue('bitbucket.acme.test')
  },
}

/** The forge's command line ready: one glyph on the line, nothing more. */
export const CliReady: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: /^api, .*GitHub, gh is ready/ })).toBeVisible()
    expect(canvas.queryByRole('button', { name: 'Check again' })).toBeNull()
  },
}

function cliStory(rules: DeliveryRules, words: RegExp, fix: string | null): Story {
  return {
    args: { rules, open: ['api'] },
    play: async ({ canvasElement, args }) => {
      const canvas = within(canvasElement)
      expect(canvas.getByRole('button', { name: words })).toBeVisible()
      if (fix !== null) {
        await userEvent.click(canvas.getByRole('button', { name: `Copy ${fix}` }))
        expect(args.onCopy).toHaveBeenCalledWith(fix)
      }
      await userEvent.click(canvas.getByRole('button', { name: 'Check again' }))
      expect(args.onCheckAgain).toHaveBeenCalledWith('api')
    },
  }
}

/** gh is not installed: the command that installs it, Copy, and Check again. */
export const CliMissing = cliStory(CLI_MISSING, /^api, .*gh is not installed/, 'brew install gh')

/** gh is signed out: the command that signs it in. */
export const CliSignedOut = cliStory(
  CLI_SIGNED_OUT,
  /^api, .*gh is signed out of github\.com/,
  'gh auth login --hostname github.com',
)

/** The forge cannot be reached: no command fixes it, Check again tries once more. */
export const CliUnreachable = cliStory(
  CLI_UNREACHABLE,
  /^api, .*github\.com cannot be reached/,
  null,
)

/** The command line being read: its glyph waits as a skeleton. */
export const CliChecking: Story = {
  args: { rules: CLI_CHECKING },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: /^api, .*Checking gh/ })).toBeVisible()
  },
}

/** Hemera proposes a dependency it read in the manifests; Accept puts web in a third wave. */
export const ProposedDependency: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const proposed = canvas.getByRole('list', { name: 'Proposed dependencies' })
    await userEvent.click(
      within(proposed).getByRole('button', { name: 'Accept: web delivers after api' }),
    )
    expect(await canvas.findByRole('list', { name: 'Wave 3' })).toHaveTextContent('web')
    await waitFor(() => {
      expect(canvas.queryByRole('list', { name: 'Proposed dependencies' })).toBeNull()
    })
  },
}

/** The End: Closing is always there and has nothing to remove; Cleanup's steps are removed one by one. */
export const EndCleanupRemoved: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const closing = canvas.getByRole('list', { name: 'Closing' })
    expect(closing).toHaveTextContent('Merge the Spec and its rounds into the living spec')
    expect(within(closing).queryByRole('button', { name: /^Remove/ })).toBeNull()
    expect(
      within(closing).getByRole('img', { name: 'Always runs: Done comes after it' }),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Pull the main checkout' }))
    await userEvent.click(
      canvas.getByRole('button', { name: 'Remove Stop the mission’s services' }),
    )
    await userEvent.click(
      canvas.getByRole('button', { name: 'Remove Remove the worktrees and the Workspace' }),
    )
    expect(
      await canvas.findByText('Nothing is cleaned up: the Workspace stays on disk.'),
    ).toBeVisible()
  },
}

/** A cleanup step of the Project's own, any of the catalogue, added after the built-in ones. */
export const EndCleanupAdded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add a cleanup step' }))
    const dialog = await findOpen(body(), 'dialog', { name: 'New cleanup step' })
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Kind' }))
    const kinds = await body().findAllByRole('option')
    expect(kinds.map((one) => one.textContent)).toEqual(CATALOGUE.map((kind) => STEP_WORDS[kind]))
    await userEvent.click(body().getByRole('option', { name: 'Command' }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Command' }))
    await userEvent.click(await body().findByRole('option', { name: 'notify-release' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    const cleanup = canvas.getByRole('list', { name: 'Cleanup' })
    await waitFor(() => {
      expect(within(cleanup).getAllByRole('listitem')).toHaveLength(4)
    })
    expect(within(cleanup).getByRole('button', { name: /notify-release/ })).toBeVisible()
  },
}

function refusedStory(
  rules: DeliveryRules,
  words: RegExp,
  open: readonly string[],
  refusals?: DeliveryRefusals,
): Story {
  return {
    args: { rules, open, refusals },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      const said = canvas.getAllByRole('alert').find((one) => words.test(one.textContent ?? ''))
      expect(said).toBeVisible()
      const nav = canvas.getByRole('navigation', { name: 'Settings of the Project' })
      expect(
        within(nav).getByRole('button', { name: 'Delivery rules, rules refused' }),
      ).toBeVisible()
    },
  }
}

/** A merge without a pull request: said under the Merge of the repository that left it out. */
export const RefusedMergeWithoutPullRequest = refusedStory(
  MERGE_WITHOUT_PR,
  /^Merge needs a pull request/,
  ['api'],
)

/** A pull request without a push. */
export const RefusedPullRequestWithoutPush = refusedStory(
  PR_WITHOUT_PUSH,
  /^A pull request needs the branch pushed/,
  ['web'],
)

/** A cycle among the repositories: no wave can go first, so they stand in one list under why. */
export const RefusedCycle: Story = {
  ...refusedStory(CYCLE_RULES, /no wave can go first/, [], CYCLE),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent(/no wave can go first/)
    expect(canvas.getByRole('list', { name: 'No order' })).toBeVisible()
    expect(canvas.queryByRole('list', { name: 'Wave 1' })).toBeNull()
  },
}

/** A bump with nothing upstream that publishes. */
export const RefusedBumpWithoutUpstream = refusedStory(
  BUMP_WITHOUT_UPSTREAM,
  /api publishes no version/,
  ['web'],
)

/** Approvals required before Ship while the pull requests open after it: said under the box. */
export const RefusedApprovalsAfterShip = refusedStory(
  APPROVAL_AFTER_SHIP_RULES,
  /^Approvals before Ship need the pull requests open before Ship/,
  [],
  APPROVAL_AFTER_SHIP,
)

/** A step the forge cannot do: Bitbucket Data Center starts no pipeline. */
export const RefusedForgeCannot = refusedStory(
  FORGE_CANNOT,
  /^Bitbucket Data Center cannot start a pipeline/,
  ['ui-kit'],
)

/** Every refusal at once: each at its own place, the repository lines carrying their glyph. */
export const RefusedEverywhere: Story = {
  args: { rules: EVERY_REFUSAL, refusals: APPROVAL_AFTER_SHIP, open: ['api', 'web'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('alert')).toHaveLength(3)
    expect(canvas.getByRole('button', { name: /^api, .*1 refused$/ })).toBeVisible()
  },
}

/** A save that meets a newer version of the rules: refused in the engine's words, the draft kept. */
export const SaveRefused: Story = {
  args: { form: { kind: 'commit' }, refused: STALE },
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Commit message' })
    const field = within(dialog).getByRole('textbox', { name: 'Commit message' })
    await userEvent.type(field, ' ({{slug})')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(STALE)
    expect(field).toHaveValue('{key}: {title} ({slug})')
  },
}

/** Everything on its way: the frames hold their rows' own shape. */
export const Loading: Story = {
  args: { rules: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('list', { name: 'Repositories', busy: true })).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(6)
  },
}

/** The rules could not be read: said under the head, in words. */
export const ReadRefused: Story = {
  args: {
    rules: null,
    error: 'Hemera could not read the delivery rules of Acme: the database is locked.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('the database is locked')
    expect(canvasElement.querySelector('[data-row-skeleton]')).toBeNull()
  },
}

/** Five repositories in two waves, fourteen reviewers, two forges in trouble. */
export const Dense: Story = {
  args: { rules: DENSE_RULES },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(
      within(canvas.getByRole('list', { name: 'Wave 1' })).getAllByRole('listitem'),
    ).toHaveLength(2)
    expect(
      within(canvas.getByRole('list', { name: 'Wave 2' })).getAllByRole('listitem'),
    ).toHaveLength(3)
    expect(
      canvas.getByRole('button', { name: /^ui-kit, .*bkt is signed out of bitbucket\.acme\.test/ }),
    ).toBeVisible()
    expect(canvas.getByRole('button', { name: /^billing, .*gh is not installed/ })).toBeVisible()
  },
}

/** A long path, a long base, long templates: each line ends in an ellipsis. */
export const LongText: Story = {
  args: { rules: LONG_RULES, open: ['services/platform-api-and-background-workers'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const commit = canvas.getByRole('button', { name: /^Commit message,/ })
    const value = within(commit).getByText(/generated by the Builder/)
    expect(getComputedStyle(value).textOverflow).toBe('ellipsis')
    expect(canvas.getByRole('button', { name: /^Pull request body, \d+ lines/ })).toBeVisible()
  },
}

/** The long body in its dialog: the field and the example grow with it, inside the dialog. */
export const LongTemplate: Story = {
  args: { rules: LONG_RULES, form: { kind: 'body' } },
  play: async () => {
    const dialog = await findOpen(body(), 'dialog', { name: 'Pull request body' })
    expect(within(dialog).getByLabelText('Pull request body for ACME-12')).toHaveTextContent(
      /Refs ACME-12 · export-invoices-as-csv/,
    )
  },
}

/** From the keyboard: a repository unfolds on Enter, a step opens on Enter, Escape gives the focus back. */
export const KeyboardPath: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const shared = canvas.getByRole('button', { name: /^shared, Library/ })
    shared.focus()
    await waitFor(() => {
      expect(getComputedStyle(shared, '::after').opacity).toBe('1')
    })
    await userEvent.keyboard('{Enter}')
    expect(shared).toHaveAttribute('aria-expanded', 'true')
    await userEvent.tab()
    expect(canvas.getByRole('combobox', { name: 'Preset of shared' })).toHaveFocus()
    const merge = await within(canvas.getByRole('list', { name: 'Steps of shared' })).findByRole(
      'button',
      { name: /^Merge,/ },
    )
    merge.focus()
    await userEvent.keyboard('{Enter}')
    const dialog = await findOpen(body(), 'dialog', { name: 'Merge · shared · After Ship' })
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(body().queryByRole('dialog')).toBeNull()
    })
    expect(merge).toHaveFocus()
  },
}

/** Asked for less movement: a repository unfolds at once. */
export const ReducedMotion: Story = {
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <Page {...args} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^web, Application/ }))
    expect(canvas.getByRole('list', { name: 'Steps of web' })).toBeVisible()
  },
}
