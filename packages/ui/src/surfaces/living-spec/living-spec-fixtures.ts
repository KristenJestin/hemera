/**
 * The living spec of the neutral Project "Acme", in the shapes the window gives the page
 * (`LivingSpecData`): the stories of the page draw from these.
 */

import type {
  LivingChange,
  LivingDomain,
  LivingOrigin,
  LivingRequirement,
  LivingSpecData,
} from './living-spec-types.ts'

const MISSION_12 = { missionId: 'm12', key: 'ACME-12', round: null }
const MISSION_12_ROUND = { missionId: 'm12', key: 'ACME-12', round: 1 }
const MISSION_19 = { missionId: 'm19', key: 'ACME-19', round: null }

/** The moment the catalogue opened: the chips count their seconds from runs started before it. */
export const NOW = Date.now()

function requirement(
  id: string,
  domainId: string,
  text: string,
  more: Partial<LivingRequirement> = {},
): LivingRequirement {
  return {
    id,
    domainId,
    text,
    scenarios: [],
    origin: null,
    state: 'validated',
    uncertainty: '',
    version: 1,
    removed: false,
    pending: null,
    ...more,
  }
}

const CHECKOUT: readonly LivingRequirement[] = [
  requirement('LR1', 'checkout', 'A guest can pay for a basket without creating an account.', {
    scenarios: [
      {
        when: 'a guest with two items in the basket pays by card',
        then: 'the order is placed and a receipt is sent to the address given',
      },
    ],
  }),
  requirement(
    'LR2',
    'checkout',
    'The basket keeps its items for thirty days on the same browser, signed in or not.',
    { origin: MISSION_12 },
  ),
  requirement(
    'LR3',
    'checkout',
    'A discount code applies once per order, and the total shows the amount it removed.',
    {
      origin: MISSION_12_ROUND,
      version: 2,
      scenarios: [
        {
          when: 'a customer enters the code SPRING10 twice',
          then: 'the second entry is refused and the total is unchanged',
        },
      ],
    },
  ),
  requirement(
    'LR4',
    'checkout',
    'Shipping costs are computed from the basket’s weight and the country of delivery.',
  ),
]

const ACCOUNTS: readonly LivingRequirement[] = [
  requirement(
    'LR5',
    'accounts',
    'A customer signs in with an email address and a password of at least twelve characters.',
    {
      state: 'proposed',
      scenarios: [
        {
          when: 'a password of eight characters is chosen',
          then: 'the form refuses it and says the minimum',
        },
      ],
    },
  ),
  requirement(
    'LR6',
    'accounts',
    'After five failed attempts, signing in is locked for fifteen minutes.',
    {
      state: 'proposed',
      uncertainty:
        'The lock is set in web/src/auth/limits.ts, but api may apply a second limit of its own: I could not find where the counter is reset.',
    },
  ),
  requirement(
    'LR7',
    'accounts',
    'A customer can delete their account; their orders are kept, without their name.',
    {
      state: 'proposed',
      uncertainty: 'Only the api side is written; I found no screen that offers it.',
    },
  ),
]

const INVOICES: readonly LivingRequirement[] = [
  requirement(
    'LR8',
    'invoices',
    'An invoice is issued when an order is shipped, not when it is paid.',
    {
      origin: MISSION_19,
      pending: {
        kind: 'replace',
        text: 'An invoice is issued when an order is paid; a shipment no longer issues one.',
        scenarios: [
          {
            when: 'an order is paid and not yet shipped',
            then: 'its invoice can be downloaded from the order page',
          },
        ],
        uncertainty:
          'shared/billing/issue.ts now issues on payment; an old path in api still mentions shipment and looks unused.',
      },
    },
  ),
  requirement('LR9', 'invoices', 'Invoices are numbered without gaps, one sequence per year.'),
  requirement(
    'LR10',
    'invoices',
    'A paper copy of each invoice is posted to the customer on request.',
    {
      pending: {
        kind: 'obsolete',
        reason:
          'The postal service integration was removed from api in July; nothing posts letters now.',
      },
    },
  ),
]

const SEARCH: readonly LivingRequirement[] = [
  requirement(
    'LR11',
    'search',
    'The catalogue search matches product names and descriptions, ignoring accents.',
    { state: 'proposed' },
  ),
  requirement('LR12', 'search', 'Results out of stock are listed after those in stock.', {
    state: 'proposed',
    uncertainty: 'The ordering is done in the browser; I am not sure the api pages respect it.',
  }),
]

/** Acme read and partly validated: the usual state of a living spec in use. */
export const FILLED: LivingSpecData = {
  domains: [
    {
      id: 'checkout',
      name: 'Checkout',
      summary: 'The basket, discounts, shipping costs and payment.',
      uncertainty: '',
      state: 'validated',
      proposed: 0,
      validated: 4,
      pending: 0,
      lastChange: '3 Oct',
    },
    {
      id: 'accounts',
      name: 'Accounts and sign-in',
      summary: 'Creating an account, signing in, and leaving.',
      uncertainty: 'Sign-in is split between web and api; I may have missed rules kept in api.',
      state: 'proposed',
      proposed: 3,
      validated: 0,
      pending: 0,
      lastChange: 'today',
    },
    {
      id: 'invoices',
      name: 'Invoices',
      summary: 'When an invoice is issued, how it is numbered and sent.',
      uncertainty: '',
      state: 'proposed',
      proposed: 0,
      validated: 3,
      pending: 2,
      lastChange: 'today',
    },
    {
      id: 'search',
      name: 'Catalogue search',
      summary: 'Finding products by name and description.',
      uncertainty: '',
      state: 'proposed',
      proposed: 2,
      validated: 0,
      pending: 0,
      lastChange: 'today',
    },
  ],
  requirements: { checkout: CHECKOUT, accounts: ACCOUNTS, invoices: INVOICES, search: SEARCH },
  runs: [
    {
      id: 'run-2',
      domainId: 'invoices',
      state: 'done',
      sentence: null,
      startedAt: NOW - 260_000,
      endedAt: NOW - 120_000,
    },
  ],
}

/** The history of the discount rule: read, validated, then changed by a mission and its round. */
export const HISTORY: readonly LivingChange[] = [
  {
    what: 'proposed',
    textBefore: null,
    textAfter: 'A discount code applies once per order.',
    by: 'bootstrap',
    byMission: null,
    at: '28 Sep',
  },
  {
    what: 'validated',
    textBefore: null,
    textAfter: null,
    by: 'user',
    byMission: null,
    at: '29 Sep',
  },
  {
    what: 'modified',
    textBefore: 'A discount code applies once per order.',
    textAfter: 'A discount code applies once per order, and the total shows the amount it removed.',
    by: 'mission',
    byMission: MISSION_12_ROUND,
    at: '3 Oct',
  },
]

/** Nothing read yet. */
export const NONE: LivingSpecData = { domains: [], requirements: {}, runs: [] }

/** The first reading, waiting for a free slot. */
export const WAITING: LivingSpecData = {
  ...NONE,
  runs: [
    {
      id: 'run-1',
      domainId: null,
      state: 'waiting_for_slot',
      sentence: 'Waits for a free slot: 3 agents of 3 are working on ACME-12 and ACME-14.',
      startedAt: NOW - 40_000,
      endedAt: null,
    },
  ],
}

/** The first reading, running. */
export const RUNNING: LivingSpecData = {
  ...NONE,
  runs: [
    {
      id: 'run-1',
      domainId: null,
      state: 'running',
      sentence: null,
      startedAt: NOW - 84_000,
      endedAt: null,
    },
  ],
}

/** The first reading, failed. */
export const FAILED: LivingSpecData = {
  ...NONE,
  runs: [
    {
      id: 'run-1',
      domainId: null,
      state: 'failed',
      sentence:
        'The agent stopped: Claude Code answered that its usage limit is reached until 14:00.',
      startedAt: NOW - 300_000,
      endedAt: NOW - 240_000,
    },
  ],
}

/** The first reading has no model to run on. */
export const NO_MODEL: LivingSpecData = { ...NONE, noModel: true }

/** The first reading just finished: every domain proposed, nothing validated yet. */
export const JUST_READ: LivingSpecData = {
  domains: FILLED.domains.map((domain) => ({
    ...domain,
    state: 'proposed',
    proposed: domain.proposed + domain.validated,
    validated: 0,
    pending: 0,
  })),
  requirements: Object.fromEntries(
    Object.entries(FILLED.requirements).map(([id, list]) => [
      id,
      list.map((one) => ({ ...one, state: 'proposed' as const, origin: null, pending: null })),
    ]),
  ),
  runs: [
    {
      id: 'run-1',
      domainId: null,
      state: 'done',
      sentence: null,
      startedAt: NOW - 412_000,
      endedAt: NOW - 30_000,
    },
  ],
}

/** A re-read of one domain on its way. */
export const REREADING: LivingSpecData = {
  ...FILLED,
  runs: [
    {
      id: 'run-3',
      domainId: 'checkout',
      state: 'running',
      sentence: null,
      startedAt: NOW - 31_000,
      endedAt: null,
    },
  ],
}

const LONG_TEXT =
  'When a customer pays with a card that asks for a second confirmation from their bank, the order stays reserved for twenty minutes, the stock of every item in it is held for that time, and if the confirmation never comes the items go back to the stock and the customer receives an email that says the payment was not completed and offers to try again from the same basket, kept as it was.'

const DENSE_NAMES = [
  'Checkout',
  'Accounts and sign-in',
  'Invoices',
  'Catalogue search',
  'Stock and warehouses',
  'Returns and refunds',
  'Notifications by email',
  'Reviews and ratings',
  'Gift cards',
  'Wish lists',
  'Admin back office',
  'Exports for accounting',
  'Shipping partners and their tracking numbers across several countries',
  'Taxes',
]

/** The origins the dense requirements take in turn. */
const DENSE_ORIGINS: readonly LivingOrigin[] = [null, MISSION_12, MISSION_12_ROUND, null]

/** Fourteen domains, one of them holding twenty-four requirements, one text very long. */
export const DENSE: LivingSpecData = {
  domains: DENSE_NAMES.map((name, index) => {
    const id = `d${String(index)}`
    const proposedState = index % 3 === 1
    return {
      id,
      name,
      summary:
        index === 0
          ? 'The basket, discounts, shipping costs and payment.'
          : `What Acme does about ${name.toLowerCase()}.`,
      uncertainty: '',
      state: proposedState ? 'proposed' : 'validated',
      proposed: proposedState ? 6 : 0,
      validated: index === 0 ? 24 : proposedState ? 0 : 6,
      pending: 0,
      lastChange: '3 Oct',
    } satisfies LivingDomain
  }),
  requirements: Object.fromEntries(
    DENSE_NAMES.map((name, index) => {
      const id = `d${String(index)}`
      const count = index === 0 ? 24 : 6
      const proposedState = index % 3 === 1
      return [
        id,
        Array.from({ length: count }, (_, at) =>
          requirement(
            `LR${String(100 + index * 30 + at)}`,
            id,
            at === 0 ? LONG_TEXT : `${name}: rule ${String(at + 1)} of what Acme does today.`,
            {
              state: proposedState ? 'proposed' : 'validated',
              origin: DENSE_ORIGINS[at % 4] ?? null,
              uncertainty: proposedState && at % 2 === 0 ? 'Read from api only.' : '',
            },
          ),
        ),
      ]
    }),
  ),
  runs: [],
}

/** The Catalogue search domain once the user validated it: its proposals are requirements. */
export const SEARCH_VALIDATED: LivingSpecData = {
  ...FILLED,
  domains: FILLED.domains.map((domain) => validatedDomain(domain)),
  requirements: {
    ...FILLED.requirements,
    search: (FILLED.requirements['search'] ?? []).map((one) => validatedRequirement(one)),
  },
}

function validatedDomain(domain: LivingDomain): LivingDomain {
  if (domain.id !== 'search') return domain
  return { ...domain, state: 'validated', proposed: 0, validated: domain.proposed }
}

function validatedRequirement(one: LivingRequirement): LivingRequirement {
  return { ...one, state: 'validated', uncertainty: '' }
}
