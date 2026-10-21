/**
 * The Reviewers dialog of the delivery rules, as it asks the forge who can review (#502): once
 * when it opens, rows of the shape to come while the answer is read, and the trouble of a command
 * line that cannot be asked, with its command and Check again.
 */

import { defaultDeliveryRules } from '@hemera/core/domain'
import type { Project, ReviewersListed } from '@hemera/ipc'
import type { SettingsForm } from '@hemera/ui'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { type DialogContext, deliveryDialogOf } from '../src/renderer/delivery-dialogs.tsx'
import { shownOf } from '../src/renderer/delivery-settings-model.ts'

const ACME: Project = {
  id: 'acme',
  name: 'Acme',
  mainCheckout: '/work/acme',
  workspacesRoot: null,
  branchPrefix: null,
  keyPrefix: 'ACME',
  version: 1,
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  repositories: [],
}

const RULES = shownOf({
  project: ACME,
  draft: defaultDeliveryRules(),
  proposed: [],
  forges: [],
  remotes: new Map(),
  commands: [],
  problems: [],
}).rules

const refused = (): Promise<void> => Promise.reject(new Error('not asked of this test'))

/** The dialogs over Acme, the forge answering as given, each asking counted. */
function contextOf(answer: () => Promise<ReviewersListed>) {
  const asked: string[] = []
  const context: DialogContext = {
    rules: RULES,
    project: ACME,
    catalogue: [],
    forgeOf: () => 'github',
    actionOf: () => undefined,
    toAction: () => ({ id: 'ci', kind: 'ci', mode: 'auto' }),
    edit: {
      template: refused,
      push: refused,
      reviewers: refused,
      repository: refused,
      stepSaved: refused,
      stepRemoved: refused,
      stepAdded: refused,
      cleanupSaved: refused,
      cleanupAdded: refused,
    },
    remotesOf: () => Promise.resolve([]),
    reviewersOf: (projectId) => {
      asked.push(projectId)
      return answer()
    },
    copy: () => undefined,
    close: () => undefined,
  }
  return { context, asked }
}

const opened = (context: DialogContext): SettingsForm => {
  const form = deliveryDialogOf({ kind: 'reviewers' }, context)
  if (form === null) throw new Error('The Reviewers dialog did not open.')
  return form
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('Adding a reviewer, listed', () => {
  test('the forge is read once per dialog opening, and nothing is said while it is read', () => {
    const { context, asked } = contextOf(() => new Promise(() => undefined))
    const form = opened(context)
    expect(asked).toEqual(['acme'])
    // The rows of the shape to come stand under what is typed: the story ReviewersReading.
    expect(renderToStaticMarkup(form.body)).not.toContain('Check again')
    opened(context)
    expect(asked).toEqual(['acme', 'acme'])
  })

  test('a command line that cannot be asked shows its trouble, its command and Check again', async () => {
    const { context, asked } = contextOf(() =>
      Promise.resolve({
        kind: 'cannot',
        sentence:
          'gh is signed out of github.com: Hemera cannot list who reviews. A handle typed below is added as it is.',
        fix: 'gh auth login --hostname github.com',
      }),
    )
    const form = opened(context)
    await settled()
    const drawn = renderToStaticMarkup(form.body)
    expect(drawn).toContain('gh is signed out of github.com')
    expect(drawn).toContain('gh auth login --hostname github.com')
    expect(drawn).toContain('Check again')
    expect(asked).toHaveLength(1)
  })
})
