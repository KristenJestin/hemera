/**
 * The Building page's Diff links (#497): the one of each repository among the changes, and the
 * one of a task opened over the page, each open the mission's diff over its base.
 */

import { AgentWorking } from '@hemera/core/domain'
import type { Mission } from '@hemera/ipc'
import type { BuildingPageProps, TaskView } from '@hemera/ui'
import { createElement, isValidElement, type ComponentProps, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { BuildingStage, taskViewsOf } from '../src/renderer/building-stage.tsx'
import type { StageFrame, StagePageProps } from '../src/renderer/stage-pages.tsx'
import { NOW, attempt, building, spec, task } from './building-fixtures.ts'
import { SILENT_LINK } from './fake-link.ts'

const MISSION: Mission = {
  id: 'm12',
  projectId: 'acme',
  key: 'ACME-12',
  title: 'Export invoices as CSV from the billing page',
  idea: { sentence: 'Export invoices', ticket: null },
  type: 'feature',
  ticketLink: null,
  origin: null,
  stage: 'building',
  round: 1,
  frozen: true,
  freeze: null,
  marks: [],
  ball: AgentWorking.make({}),
  needs: [],
  cleanup: null,
  unstopped: [],
  triage: null,
  createdAt: '2026-10-12T08:00:00.000Z',
  updatedAt: '2026-10-12T09:00:00.000Z',
}

const none = (): undefined => undefined

/** The Building page drawn once, what it hands its frame kept. */
function framed(open: (view: string) => void): StageFrame {
  let parts: StageFrame | null = null
  const props: StagePageProps = {
    link: SILENT_LINK,
    engineReady: false,
    mission: MISSION,
    open,
    goMission: none,
    readiness: null,
    openChat: none,
    kept: [],
    freeze: none,
    freezing: false,
    needs: { rows: [], on: () => ({}) },
    frame: (given) => {
      parts = given
      return null
    },
  }
  renderToStaticMarkup(createElement(BuildingStage, props))
  if (parts === null) throw new Error('the page drew no frame')
  return parts
}

const recorder = () => {
  const opened: string[] = []
  return { opened, open: (view: string) => void opened.push(view) }
}

describe('The Diff links of the Building page', () => {
  test('a repository’s Diff, among the changes, opens the mission’s diff', () => {
    const { opened, open } = recorder()
    const base: ReactNode = framed(open).base
    if (!isValidElement<BuildingPageProps>(base)) throw new Error('the base is no page')
    base.props.onOpenDiff?.('api')
    expect(opened).toEqual(['diff'])
  })

  test('a task’s diff, in its view over the page, opens the mission’s diff', () => {
    const { opened, open } = recorder()
    const view = building({
      tasks: [
        task({
          attempts: [
            attempt({
              files: [
                {
                  repository: 'api',
                  path: 'src/export.ts',
                  status: 'M',
                  added: 4,
                  removed: 1,
                  outside: false,
                },
              ],
            }),
          ],
        }),
      ],
    })
    const [one] = taskViewsOf(view, spec({ stage: 'building' }), open, NOW)
    if (one === undefined) throw new Error('no task view')
    expect(renderToStaticMarkup(createElement('div', null, one.body))).toContain('The task’s diff')
    const body: ReactNode = one.body
    if (!isValidElement<ComponentProps<typeof TaskView>>(body)) throw new Error('no task view')
    body.props.onOpenDiff?.('T1')
    expect(opened).toEqual(['diff'])
  })
})
