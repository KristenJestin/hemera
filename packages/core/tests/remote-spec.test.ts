/**
 * A remote Spec (#98): the eight sections of a frozen Spec written as a ticket's description, in
 * Markdown for a GitHub issue, in Atlassian Document Format for Jira Cloud and in wiki markup for
 * Jira Data Center. Nothing else is written: no Proof block, no task, no Memory, no status, no
 * link, no id of Hemera's beyond the requirement and scenario labels. Read back through #95's
 * `readSections` (and #96's converters first), it gives the eight sections and every scenario.
 */

import * as fc from 'fast-check'
import { Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  REMOTE_SPEC_LIMITS,
  SPEC_SECTIONS,
  type SpecText,
  TICKET_SECTIONS,
  type TicketScenario,
  adfToMarkdown,
  readSections,
  remoteSpecReadBack,
  remoteSpecTooLong,
  renderRemoteSpec,
  wikiToMarkdown,
} from '../src/domain/index.ts'

const scenario = (id: string, when: string, then: string) => ({
  id,
  when,
  then,
  version: 1,
  proof: {
    mode: 'by_hand' as const,
    actions: ['Export the invoices'],
    starting_data: 'PROOF-STARTING-DATA',
    expected: 'PROOF-EXPECTED',
    seen_today: false,
  },
  proofVersion: 1,
})

const written = (): SpecText => ({
  key: 'ACME-12',
  title: 'Export the invoices as CSV',
  type: 'feature',
  language: 'fr',
  version: 9,
  sections: SPEC_SECTIONS.map((name) => ({
    name,
    body: `Le texte de ${name}.\nSur deux lignes.`,
    version: 1,
  })),
  requirements: [
    {
      id: 'R1',
      domain: 'invoices',
      delta: 'added',
      livingRef: null,
      livingVersion: null,
      text: 'Les factures s’exportent en CSV.',
      version: 1,
      removed: false,
      scenarios: [
        scenario('R1.S1', 'l’utilisateur exporte les factures', 'un fichier CSV est enregistré'),
        scenario('R1.S2', 'une facture porte un accent', 'le fichier le garde'),
      ],
    },
    {
      id: 'R2',
      domain: 'api',
      delta: 'modified',
      livingRef: 'api.R3',
      livingVersion: 2,
      text: 'L’API renvoie le CSV.',
      version: 1,
      removed: false,
      scenarios: [scenario('R2.S1', 'le client appelle /export', 'il reçoit le CSV')],
    },
    {
      id: 'R3',
      domain: 'web',
      delta: 'removed',
      livingRef: 'web.R1',
      livingVersion: 1,
      text: 'L’ancien export PDF disparaît.',
      version: 1,
      removed: false,
      scenarios: [],
    },
    {
      id: 'R4',
      domain: 'shared',
      delta: 'added',
      livingRef: null,
      livingVersion: null,
      text: 'REMOVED-FROM-THE-SPEC',
      version: 2,
      removed: true,
      scenarios: [],
    },
  ],
  tasks: [
    {
      id: 'T1',
      title: 'TASK-TITLE',
      result: 'TASK-RESULT',
      requirements: ['R1'],
      scenarios: ['R1.S1'],
      targets: [],
      dependsOn: [],
    },
  ],
  tasksVersion: 1,
  recommendation: { agent: 'claude', model: 'MODEL-NAME', effort: null, reason: 'MODEL-REASON' },
})

const TARGETS = ['markdown', 'adf', 'wiki'] as const

const parseJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))

/** The description a tracker hands back for a rendered text, as Markdown. */
const BACK: Readonly<Record<(typeof TARGETS)[number], (rendered: string) => string>> = {
  markdown: (rendered) => rendered,
  adf: (rendered) => adfToMarkdown(parseJson(rendered)),
  wiki: (rendered) => wikiToMarkdown(rendered),
}
const backAsMarkdown = (rendered: string, target: (typeof TARGETS)[number]): string =>
  BACK[target](rendered)

/** The fixture with its sections' bodies given by `bodyOf` and these requirements. */
const specWith = (
  bodyOf: (name: (typeof SPEC_SECTIONS)[number]) => string,
  requirements: SpecText['requirements'] = written().requirements,
): SpecText => {
  const base = written()
  return {
    key: base.key,
    title: base.title,
    type: base.type,
    language: base.language,
    version: base.version,
    sections: SPEC_SECTIONS.map((name) => ({ name, body: bodyOf(name), version: 1 })),
    requirements,
    tasks: base.tasks,
    tasksVersion: base.tasksVersion,
    recommendation: base.recommendation,
  }
}

/** The sections as they are read back, in the order Hemera writes them. */
const readOrder = [
  'why',
  'goals',
  'impact',
  'requirements',
  'decisions',
  'risks',
  'migration',
  'open_questions',
]

describe('The eight sections, under their English names, in order, and nothing else', () => {
  test('Markdown: the sections in order, the requirements with their delta and WHEN/THEN scenarios', () => {
    const text = renderRemoteSpec(written(), 'markdown')
    const headings = text.split('\n').filter((line) => line.startsWith('## '))
    expect(headings).toEqual([
      '## Why',
      '## Goals / Non-goals',
      '## Impact',
      '## Requirements',
      '## Decisions',
      '## Risks & trade-offs',
      '## Migration plan',
      '## Open questions',
    ])
    expect(text).toContain('Le texte de why.\nSur deux lignes.')
    expect(text).toContain('**R1 · Added · invoices**')
    expect(text).toContain('**R2 · Modified · api**')
    expect(text).toContain('**R3 · Removed · web**')
    expect(text).toContain(
      '- **R1.S1**\n  - **WHEN** l’utilisateur exporte les factures\n  - **THEN** un fichier CSV est enregistré',
    )
  })

  test.each(TARGETS)(
    '%s: no Proof, no task, no model, no status, no link, no mission key, no removed requirement',
    (target) => {
      const text = renderRemoteSpec(written(), target)
      for (const absent of [
        'PROOF-',
        'Proof',
        'TASK-',
        'T1',
        'MODEL-',
        'Model for Building',
        'Tasks',
        'ACME-12',
        'Export the invoices as CSV',
        'Version',
        'Spec language',
        'http',
        'REMOVED-FROM-THE-SPEC',
        'R4',
        'api.R3',
      ]) {
        expect(text).not.toContain(absent)
      }
    },
  )

  test('the known secret values are masked before rendering', () => {
    const leaking = specWith((name) =>
      name === 'why' ? 'The token hunter2-value leaks.' : `Le texte de ${name}.`,
    )
    for (const target of TARGETS) {
      const text = renderRemoteSpec(leaking, target, (value) =>
        value.replaceAll('hunter2-value', '•••'),
      )
      expect(text).not.toContain('hunter2-value')
      expect(text).toContain('•••')
    }
  })

  test('a heading the Planner wrote inside a section never becomes a section of its own', () => {
    const headed = specWith((name) =>
      name === 'why'
        ? '# Context\nText.\n\nUnderlined\n---\n\n```\n## Not a heading\n'
        : `Le texte de ${name}.`,
    )
    for (const target of TARGETS) {
      const read = readSections(backAsMarkdown(renderRemoteSpec(headed, target), target))
      expect(read.sections.map((one) => one.section)).toEqual([...readOrder])
      expect(read.unrecognised).toEqual([])
    }
  })
})

describe('Read back through readSections, it gives the eight sections and every scenario', () => {
  test.each(TARGETS)('%s, for the fixture', (target) => {
    const read = readSections(backAsMarkdown(renderRemoteSpec(written(), target), target))
    expect(read.sections.map((one) => one.section)).toEqual(readOrder)
    expect(new Set(readOrder)).toEqual(new Set(TICKET_SECTIONS))
    expect(read.sections.find((one) => one.section === 'requirements')?.scenarios).toEqual([
      { when: 'l’utilisateur exporte les factures', then: 'un fichier CSV est enregistré' },
      { when: 'une facture porte un accent', then: 'le fichier le garde' },
      { when: 'le client appelle /export', then: 'il reçoit le CSV' },
    ])
    expect(read.sections.find((one) => one.section === 'why')?.text.trim()).toBe(
      'Le texte de why.\nSur deux lignes.',
    )
  })

  /** Words of a Spec, in any language: never a scenario keyword of its own. */
  const words = fc
    .stringMatching(/^[\p{L}\p{N}][\p{L}\p{N} .,'’:/()?!*_{}[\]~|@#<>-]{0,30}$/u)
    .filter((value) => !/WHEN|THEN/.test(value))
  const body = fc.array(fc.oneof(words, fc.constant(''), fc.constant('# A heading')), {
    maxLength: 5,
  })
  const scenarios = fc.array(fc.tuple(words, words), { maxLength: 3 })
  const spec = fc
    .tuple(
      fc.array(body, { minLength: 7, maxLength: 7 }),
      fc.array(fc.tuple(words, fc.constantFrom('added', 'modified', 'removed'), scenarios), {
        maxLength: 3,
      }),
    )
    .map(([bodies, requirements]) =>
      specWith(
        (name) => (bodies[SPEC_SECTIONS.indexOf(name)] ?? []).join('\n'),
        requirements.map(([text, delta, pairs], index) => ({
          id: `R${String(index + 1)}`,
          domain: 'shared',
          delta,
          livingRef: null,
          livingVersion: null,
          text,
          version: 1,
          removed: false,
          scenarios: pairs.map(([when, then], at) =>
            scenario(`R${String(index + 1)}.S${String(at + 1)}`, when, then),
          ),
        })),
      ),
    )
  const flat = (value: string) => value.replace(/\s+/g, ' ').trim()
  const expected = (one: SpecText): ReadonlyArray<TicketScenario> =>
    one.requirements.flatMap((requirement) =>
      requirement.scenarios.map((each) => ({ when: flat(each.when), then: flat(each.then) })),
    )

  test.each(TARGETS)('%s, for any Spec', (target) => {
    fc.assert(
      fc.property(spec, (one) => {
        const read = readSections(backAsMarkdown(renderRemoteSpec(one, target), target))
        expect(read.sections.map((part) => part.section)).toEqual(readOrder)
        expect(read.unrecognised).toEqual([])
        const found = read.sections.find((part) => part.section === 'requirements')?.scenarios
        expect(found?.map((each) => ({ when: flat(each.when), then: flat(each.then) }))).toEqual(
          expected(one),
        )
      }),
      { numRuns: 200 },
    )
  })
})

describe('Markdown for GitHub: a write never notifies anyone, links an issue or carries HTML', () => {
  const ZWJ = '\u200d'
  const loud = specWith(
    (name) =>
      name === 'why'
        ? 'Ask @ada about #12 and acme/shop#7.\n<img src=x onerror=alert(1)> <!-- hidden -->\n> A quote stays a quote.\nAs `@ada <b>` says.\n\n```\n@ada <b> #3\n```'
        : `Le texte de ${name}.`,
    [
      {
        id: 'R1',
        domain: 'invoices',
        delta: 'added',
        livingRef: null,
        livingVersion: null,
        text: 'Les factures s’exportent en CSV.',
        version: 1,
        removed: false,
        scenarios: [scenario('R1.S1', 'a ** b by @grace', 'issue #4 gets <b>bold</b>**')],
      },
    ],
  )

  test('mentions and issue references are neutralised, < and > written as entities, code kept', () => {
    const text = renderRemoteSpec(loud, 'markdown')
    expect(text).toContain(`Ask @${ZWJ}ada about #${ZWJ}12 and acme/shop#${ZWJ}7.`)
    expect(text).toContain('&lt;img src=x onerror=alert(1)&gt; &lt;!-- hidden --&gt;')
    expect(text).toContain('\n> A quote stays a quote.\n')
    expect(text).toContain('As `@ada <b>` says.')
    expect(text).toContain('\n@ada <b> #3\n')
    expect(text).not.toMatch(/@(?!\u200d)\w(?![^`]*`)/u)
  })

  test('the WHEN and THEN keywords stay bold whatever stars the text holds', () => {
    const text = renderRemoteSpec(loud, 'markdown')
    expect(text).toContain(
      `  - **WHEN** a \\*\\* b by @${ZWJ}grace\n  - **THEN** issue #${ZWJ}4 gets &lt;b&gt;bold&lt;/b&gt;\\*\\*`,
    )
  })

  test('read back, the scenario says what the Planner wrote, the neutralisers left out', () => {
    const read = readSections(renderRemoteSpec(loud, 'markdown'))
    expect(read.sections.find((one) => one.section === 'requirements')?.scenarios).toEqual([
      { when: 'a ** b by @grace', then: 'issue #4 gets <b>bold</b>**' },
    ])
  })
})

describe('Wiki markup: what the Planner wrote can never become a macro, a mention or an embed', () => {
  const tricky = specWith(
    (name) =>
      name === 'why'
        ? 'Ask [~ada] about {code}it{code}, see !http://images.test/a.png! and [the notes|http://notes.test].\n|| a || b ||\n\n```ts\nconst a = "{noformat}"\n{code}\n```'
        : `Le texte de ${name}.`,
    [
      {
        id: 'R1',
        domain: 'invoices',
        delta: 'added',
        livingRef: null,
        livingVersion: null,
        text: 'Les factures s’exportent en CSV.',
        version: 1,
        removed: false,
        scenarios: [scenario('R1.S1', 'a {quote} by [~grace]', 'the !logo.png! shows ~once~')],
      },
    ],
  )

  test('every brace, bracket, bang, tilde and pipe in text is escaped', () => {
    const text = renderRemoteSpec(tricky, 'wiki')
    expect(text).toContain(
      'Ask \\[\\~ada] about \\{code}it\\{code}, see \\!http://images.test/a.png\\! and \\[the notes\\|http://notes.test].',
    )
    expect(text).toContain('\\|\\| a \\|\\| b \\|\\|')
    expect(text).toContain(
      '** *WHEN* a \\{quote} by \\[\\~grace]\n** *THEN* the \\!logo.png\\! shows \\~once\\~',
    )
    // Outside the code block, no brace, bracket, bang, tilde or pipe is left unescaped.
    const outside = text.replace(/\{noformat\}\n[^]*?\n\{noformat\}/g, '')
    for (const line of outside.split('\n')) {
      expect(line).not.toMatch(/(^|[^\\])[{[!~|]/)
    }
  })

  test('code is a {noformat} block no line inside it can close', () => {
    const text = renderRemoteSpec(tricky, 'wiki')
    // The Planner's ```ts fence is written as a {noformat}, never as a {code:ts} macro.
    expect(text).not.toContain('{code:ts}')
    const opened = text.indexOf('{noformat}\n')
    const closed = text.indexOf('\n{noformat}\n', opened)
    // Inside it nothing is escaped (wiki markup shows a backslash there): only the code's own
    // `{noformat}` is kept from closing it.
    expect(text.slice(opened, closed)).toContain('const a = "{\u200bnoformat}"\n{code}')
    // Exactly one block opens and closes: the code's own `{noformat}` does not end it.
    expect(text.match(/\{noformat\}/g)).toHaveLength(2)
  })

  test('read back, the scenario says what the Planner wrote', () => {
    const read = readSections(wikiToMarkdown(renderRemoteSpec(tricky, 'wiki')))
    expect(read.sections.find((one) => one.section === 'requirements')?.scenarios).toEqual([
      { when: 'a {quote} by [~grace]', then: 'the !logo.png! shows ~once~' },
    ])
  })
})

describe('What the tracker hands back, and a Spec too long for it', () => {
  test.each(TARGETS)('%s: the read-back is the Markdown the provider reads', (target) => {
    const rendered = renderRemoteSpec(written(), target)
    expect(remoteSpecReadBack(rendered, target)).toBe(backAsMarkdown(rendered, target))
  })

  test('a text over the limit is too long; at the limit it is not; it is never cut', () => {
    const long = (size: number) => specWith((name) => (name === 'why' ? 'x'.repeat(size) : ''), [])
    const overhead = renderRemoteSpec(long(1), 'markdown').length - 1
    const exact = renderRemoteSpec(long(REMOTE_SPEC_LIMITS.github - overhead), 'markdown')
    expect(exact.length).toBe(REMOTE_SPEC_LIMITS.github)
    expect(remoteSpecTooLong(exact, REMOTE_SPEC_LIMITS.github)).toBe(false)
    const over = renderRemoteSpec(long(REMOTE_SPEC_LIMITS.github - overhead + 1), 'markdown')
    expect(remoteSpecTooLong(over, REMOTE_SPEC_LIMITS.github)).toBe(true)
    expect(over).toContain('x'.repeat(REMOTE_SPEC_LIMITS.github - overhead + 1))
    const jira = renderRemoteSpec(long(REMOTE_SPEC_LIMITS.jira), 'adf')
    expect(remoteSpecTooLong(jira, REMOTE_SPEC_LIMITS.jira)).toBe(true)
  })

  test('ADF is measured as the JSON sent, longer than the text it reads back as', () => {
    const json = renderRemoteSpec(written(), 'adf')
    const limit = json.length - 1
    expect([...remoteSpecReadBack(json, 'adf')].length).toBeLessThan(limit)
    expect(remoteSpecTooLong(json, limit)).toBe(true)
    expect(remoteSpecTooLong(json, json.length)).toBe(false)
  })
})
