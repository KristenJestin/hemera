/**
 * The cast the shell's fixtures share: Acme, its mission ACME-12 in Review, its repositories and
 * its Chats. Apart from the fixtures that use them so those do not import one another.
 */
export const ACME = { id: 'acme', name: 'Acme' }

export const MISSION = {
  key: 'ACME-12',
  title: 'Export invoices as CSV from the billing page',
  branch: 'feat/acme-12-export-invoices',
  spec: 'frozen yesterday at 17:02',
}

export const STAGE = { label: 'Review · round 1', tone: 'warning' } as const

export const LONG_TITLE =
  'Export invoices as CSV from the billing page, with the customer filters kept and a progress for the long ones'

export const REPOSITORIES = [{ name: 'api' }, { name: 'web' }, { name: 'shared' }]

/** Acme's Chats, listed under it in the sidebar. */
export const CHATS = [
  { id: 'invoices', title: 'Invoices export' },
  { id: 'release', title: 'Release notes for 2.4' },
] as const
