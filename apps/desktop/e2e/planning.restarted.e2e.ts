/**
 * Hemera started again on the data folder `planning.e2e.ts` left, with Freeze offered: every
 * answer and where it stands, the decision of the discussion (read again from its question), the
 * Probe's chip, the vision and the cold read's report are found as they were, and the Spec is
 * frozen.
 */

import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { $, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine } from './diagnostic.ts'
import { DECISION, DRAFT_MARK, NOT_PROBED } from './planning-script.ts'
import { designSize } from './settings-page.ts'

const SPEC = 'planning.restarted.e2e.ts'
const PLANNED = join(tmpdir(), 'hemera-e2e-planning-mission.json')

const places = () => $('nav[aria-label="Places"]')
const spec = () => $('section[aria-label="Spec"]')
const rail = () => $('aside[aria-label="What calls for you"]')
const card = (id: string) => rail().$(`article[aria-label^="${id} ·"]`)
const track = () => $('ol[aria-label="Stage"]')

describe('A mission’s Planning, found again after Hemera started anew', () => {
  // SAFETY: `planning.e2e.ts` wrote this file as `{ key }` just before Hemera was restarted.
  const before = JSON.parse(readFileSync(PLANNED, 'utf8')) as { key: string }

  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('opens the mission on its Planning page, its Spec as it was written', async () => {
    await waitForEngine()
    await designSize()
    await places().$('button*=Acme').click()
    await $('ul[aria-label="Planning missions"]').$(`button*=${before.key}`).click()
    await expect(spec().$('section[aria-label="Why"]')).toHaveText(
      expect.stringContaining(DRAFT_MARK),
    )
    await expect(spec().$('section[aria-label="Decisions"]')).toHaveText(
      expect.stringContaining(DECISION),
    )
    await expect(spec().$('section[aria-label="Risks & trade-offs"]')).toHaveText(
      expect.stringContaining(NOT_PROBED),
    )
  })

  it('keeps every answer, each still integrated, and the question made moot', async () => {
    await expect(card('Q1').$('[data-input="integrated"]')).toBeExisting()
    await expect(card('Q2').$('[data-input="integrated"]')).toBeExisting()
    await expect(card('Q3').$('[data-input="integrated"]')).toBeExisting()
    await expect(card('Q1')).toHaveText(expect.stringContaining('A · Anyone who can read it'))
    await expect(card('Q2')).toHaveText(expect.stringContaining('B · GitHub'))
    await expect(card('Q4')).toHaveText(expect.stringContaining(`Moot: ${DECISION}`))
  })

  it('reads the discussion again from its question, closed on its decision', async () => {
    await card('Q4').$('button=Open the discussion').click()
    await expect($('[data-view^="discussion:"]')).toHaveText(
      expect.stringContaining(`Closed on a decision: ${DECISION}`),
    )
    await $('button[aria-label^="Close Discussion"]').click()
    await expect($('[data-view^="discussion:"]')).not.toBeExisting()
  })

  it('keeps the vision, the Probe’s chip and the cold read’s report', async () => {
    await expect(rail().$('ul[aria-label="Your vision so far"]')).toHaveText(
      expect.stringContaining('one note at a time'),
    )
    await expect(
      rail().$('section[aria-label="Probes"]').$('button[data-live-chip]'),
    ).toHaveAttribute('data-state', 'failed')
    await expect(rail().$('section[aria-label="Cold read"]')).toHaveText(
      expect.stringContaining('Nothing found.'),
    )
  })

  it('still offers Freeze, which freezes the Spec', async () => {
    await $('button=Freeze').click()
    await expect(track().$('li[aria-current="step"]')).toHaveText('Ready', {
      containing: true,
      wait: 30_000,
    })
    await expect($('button=Freeze')).not.toBeExisting()
  })
})
