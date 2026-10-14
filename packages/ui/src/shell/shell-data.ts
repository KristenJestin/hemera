import { ACME_LOGO } from '../components/project-mark/project-mark-fixtures.ts'
import { type NoticeItem } from './notice.tsx'
import { ACME } from './shell-cast.ts'
import { type SidebarProject } from './sidebar.tsx'

/**
 * The neutral case every story of the shell is drawn on: a Project "Acme" with the repositories
 * `api`, `web` and `shared`, its mission `ACME-12` in Review, and Hemera itself as a second
 * Project. And a small machine around the shell — where the user is, the sidebar's fold, the
 * views open over a mission, the notifications — so a story can walk the journey a window
 * walks. Nothing here is an engine: a story holds the state the renderer's hooks will hold.
 */
export const HEMERA = { id: 'hemera', name: 'Hemera' }

export const PROJECTS: readonly SidebarProject[] = [ACME, HEMERA]

/** A long name in every field: what a Project of a real team can be called. */
export const LONG_NAME = 'Acme Platform Services and Internal Tooling (monorepo, 2026)'

/** Twelve Projects, most of them long: the sidebar at its densest. */
export const MANY_PROJECTS: readonly SidebarProject[] = [
  ACME,
  HEMERA,
  { id: 'p3', name: LONG_NAME },
  { id: 'p4', name: 'Billing' },
  { id: 'p5', name: 'Customer portal and self-service onboarding' },
  { id: 'p6', name: 'Data pipeline' },
  { id: 'p7', name: 'Design system' },
  { id: 'p8', name: 'Edge workers' },
  { id: 'p9', name: 'Fleet' },
  { id: 'p10', name: 'Gateway and public API documentation site' },
  { id: 'p11', name: 'Helpdesk' },
  { id: 'p12', name: 'Infrastructure as code' },
]

/** Projects marked as their users chose: an icon in a tone, a logo, and letters. */
export const MARKED_PROJECTS: readonly SidebarProject[] = [
  ACME,
  { ...HEMERA, identity: { tone: 'primary', icon: 'rocket' } },
  { id: 'p4', name: 'Billing', identity: { image: ACME_LOGO } },
  { id: 'p6', name: 'Data pipeline', identity: { tone: 'build', icon: 'database' } },
  { id: 'p7', name: 'Design system', identity: { tone: 'warning' } },
]

export const NOTICES: readonly NoticeItem[] = [
  {
    id: 'n1',
    tone: 'you',
    project: 'Acme',
    missionKey: 'ACME-12',
    title: 'Run the migration on the shared database',
    detail: 'The Builder asks before touching it',
  },
  {
    id: 'n2',
    tone: 'done',
    project: 'Acme',
    missionKey: 'ACME-9',
    title: 'Shipped',
    detail: 'api and web merged, the release is tagged',
  },
  {
    id: 'n3',
    tone: 'failed',
    project: 'Hemera',
    missionKey: 'HEM-58',
    title: 'Checks failed after the merge',
    detail: 'verify on Windows: 2 tests',
  },
  {
    id: 'n4',
    tone: 'outside',
    project: 'Acme',
    title: 'web changed outside Hemera',
    detail: 'main moved by 3 commits',
  },
]
