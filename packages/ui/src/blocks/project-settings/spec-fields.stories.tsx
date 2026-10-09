import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { SPEC_MODE_WORDS, SpecFields } from './spec-fields.tsx'

/**
 * The frame under the ticket providers: where Specs live (Local or Linked, with what the mode does
 * written under it), the language Specs are written in, how often a linked ticket is read, and the
 * key prefix the next missions take.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Spec fields',
  component: SpecFields,
  parameters: { layout: 'fullscreen' },
  args: {
    mode: 'linked',
    modes: ['local', 'linked'],
    onMode: fn(),
    language: 'en',
    onLanguage: fn(),
    prefix: 'ACME',
    onPrefix: fn(),
    sync: { minutes: 60, minimum: 15, lastCheck: '09:41', onMinutes: fn() },
  },
  argTypes: { sync: { table: { disable: true } } },
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpecFields>

export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** Linked Specs checked every hour: the mode's words, the last check and the prefix. */
export const Linked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Specs' })).toBeVisible()
    await expect(canvas.getByText(SPEC_MODE_WORDS.linked.does)).toBeVisible()
    await expect(canvas.getByText('Last checked at 09:41')).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Key prefix' })).toHaveValue('ACME')
    await expect(canvas.getByText(/Only the next missions change: ACME-13 and after/)).toBeVisible()
  },
}

/** Local Specs: the words of the mode, and no sync row. */
export const Local: Story = {
  args: { mode: 'local' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(SPEC_MODE_WORDS.local.does)).toBeVisible()
    await expect(canvas.queryByText(/Last checked/)).toBeNull()
    await expect(canvas.queryByRole('combobox', { name: 'Check linked tickets' })).toBeNull()
  },
}

/** The sync row is drawn for the linked mode only, and only once it is fed. */
export const NoSyncYet: Story = {
  args: { sync: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(SPEC_MODE_WORDS.linked.does)).toBeVisible()
    await expect(canvas.queryByRole('combobox', { name: 'Check linked tickets' })).toBeNull()
  },
}

/** A linked project never checked: the row says so. */
export const NeverChecked: Story = {
  args: { sync: { minutes: 30, minimum: 15, lastCheck: null, onMinutes: fn() } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Not checked yet')).toBeVisible()
  },
}

/** Remote is never offered until it can be used. */
export const RemoteNotOffered: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Where Specs live' }))
    const local = await body().findByRole('option', { name: 'Local' })
    await waitFor(() => expect(local).toBeVisible())
    await expect(body().getByRole('option', { name: 'Linked' })).toBeInTheDocument()
    await expect(body().queryByRole('option', { name: 'Remote' })).toBeNull()
    await userEvent.keyboard('{Escape}')
  },
}

/** Choosing a mode by the keyboard tells the page. */
export const ChooseAMode: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Where Specs live' }))
    await userEvent.click(await body().findByRole('option', { name: 'Local' }))
    await waitFor(() => expect(args.onMode).toHaveBeenCalledWith('local'))
  },
}

/** The language keeps the current tag even when the short list does not hold it. */
export const UnlistedLanguage: Story = {
  args: { language: 'pt-BR' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const select = canvas.getByRole('combobox', { name: 'Spec language' })
    await expect(select).toHaveTextContent('pt-BR')
    await userEvent.click(select)
    await userEvent.click(await body().findByRole('option', { name: 'French' }))
    await waitFor(() => expect(args.onLanguage).toHaveBeenCalledWith('fr'))
  },
}

/** The Specs are being read: nothing is chosen, and nothing can be written. */
export const Reading: Story = {
  args: { mode: null, language: null, prefix: null, sync: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Where Specs live' })).toBeDisabled()
    await expect(canvas.getByRole('textbox', { name: 'Key prefix' })).toBeDisabled()
  },
}

/** The prefix is still carried by another Project's missions: refused under the field. */
export const PrefixRefused: Story = {
  args: {
    prefix: 'SHOP',
    prefixRefused:
      'SHOP is still carried by the missions of the Project Shop (SHOP-3 to SHOP-41): two missions never share a key.',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/two missions never share a key/)).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Key prefix' })).toBeInvalid()
  },
}

/** Typing a prefix tells the page at each change; the engine is asked once the typing settles. */
export const TypePrefix: Story = {
  render: (args) => {
    const [prefix, setPrefix] = useState(args.prefix)
    return (
      <SpecFields
        {...args}
        prefix={prefix}
        onPrefix={(value) => {
          setPrefix(value)
          args.onPrefix(value)
        }}
      />
    )
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const field = canvas.getByRole('textbox', { name: 'Key prefix' })
    await userEvent.clear(field)
    await userEvent.type(field, 'SHOP')
    await expect(args.onPrefix).toHaveBeenLastCalledWith('SHOP')
    await expect(canvas.getByText(/Only the next missions change: SHOP-13/)).toBeVisible()
  },
}

/** A change refused: the sentence sits under the section's head. */
export const Refused: Story = {
  args: { refused: 'The Spec mode could not be saved: the engine did not answer.' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'The Spec mode could not be saved',
    )
  },
}

/** Long values: a long language tag and a six-letter prefix do not break the frame. */
export const Dense: Story = {
  args: { language: 'zh-Hant-TW-u-ca-chinese', prefix: 'ABCDE9' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('combobox', { name: 'Spec language' })).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Key prefix' })).toHaveValue('ABCDE9')
  },
}

/** The sync interval: the minimum is never undercut, and a change tells the page. */
export const ChangeTheInterval: Story = {
  args: { sync: { minutes: 60, minimum: 60, lastCheck: '09:41', onMinutes: fn() } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('combobox', { name: 'Check linked tickets' }))
    await expect(body().queryByRole('option', { name: 'Every 15 minutes' })).toBeNull()
    await userEvent.click(await body().findByRole('option', { name: 'Every 4 hours' }))
    await waitFor(() => expect(args.sync?.onMinutes).toHaveBeenCalledWith(240))
  },
}
