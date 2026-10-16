/**
 * A sensitive file's content reaches no agent without a question (#392). `search` read every file
 * of the place, a committed `.env` included, and printed its lines; `fs_read` on the same file
 * asks first. Every tool that hands a file's content goes through the sensitive places, and a
 * search names a sensitive file as withheld, never prints a line of it.
 *
 * The engine is the real one, its order of decision included; the human question is the suite's,
 * which keeps what it was asked. Data, work and home are temporary folders.
 */

import { execFileSync } from 'node:child_process'
import { linkSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { TOOL_NAMES, type ToolName } from '@hemera/core/domain'
import { Effect } from 'effect'
import type { Schema } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { commandsEngine } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeWithMission, callTool, questionsKept, sessionOf } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('sensitive-content'))
  work = realpathSync.native(temporaryFolder('sensitive-content-work'))
})
afterEach(removeFolders)

/** Values no shape of a credential recognises: only reading the file shows them. */
const REGION = 'quartz-violet-4471'
const BUCKET = 'amber-heron-9083'

/** What each search looks for: a word every file holds, the sensitive ones included. */
const WORD = 'acme'

/**
 * A Builder's place whose `.env` and `config/.env.production` are committed, beside a source file
 * and an `.env` template that hold the same word.
 */
const committed = (main: string) => {
  mkdirSync(join(main, 'config'), { recursive: true })
  writeFileSync(join(main, '.env'), `ACME_REGION=${REGION}\n`)
  writeFileSync(join(main, 'config', '.env.production'), `ACME_BUCKET=${BUCKET}\n`)
  writeFileSync(join(main, '.env.example'), 'ACME_REGION=\n')
  writeFileSync(join(main, 'invoices.ts'), 'export const acme = []\n')
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Acme', '-c', 'user.email=acme@example.invalid', ...args],
      {
        cwd: main,
        stdio: 'ignore',
      },
    )
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'acme')
}

/** The answers of a Builder's calls on a committed place, and the questions they became. */
const builderCalls = async (
  calls: ReadonlyArray<{ readonly tool: string; readonly args: Schema.JsonObject }>,
  more: (main: string) => void = () => undefined,
) => {
  const questions = questionsKept()
  const answers = await commandsEngine(data, {
    tools: { home: work, permissionRequests: questions.layer },
  })(({ profile }) =>
    profile.use(
      Effect.gen(function* () {
        const { mission, main } = yield* acmeWithMission(work)
        committed(main)
        more(main)
        const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
        return yield* Effect.forEach(calls, (one) => callTool(builder.grantId, one.tool, one.args))
      }),
    ),
  )
  return { answers, asked: questions.asked }
}

/** What a search answers of the two sensitive files: never a line, each named as withheld. */
const withheldBoth = (text: string) => {
  expect(text).not.toContain(REGION)
  expect(text).not.toContain(BUCKET)
  expect(text).not.toMatch(/^\.env:\d+:/m)
  expect(text).not.toMatch(/^config\/\.env\.production:\d+:/m)
  expect(text).toMatch(/(^|[ ,])\.env \(content withheld: sensitive place: [^)]*\.env\)/)
  expect(text).toMatch(
    /config\/\.env\.production \(content withheld: sensitive place: [^)]*\.env\.production\)/,
  )
}

describe('search withholds a sensitive file’s lines', () => {
  test('a search with no glob prints no line of .env nor config/.env.production, and names each as withheld', async () => {
    const { answers, asked } = await builderCalls([{ tool: 'search', args: { pattern: WORD } }])
    const [answer] = answers
    expect(answer?.ok).toBe(true)
    withheldBoth(answer?.text ?? '')
    // What is not sensitive is still searched: the source file and the template.
    expect(answer?.text).toContain('invoices.ts:1: export const acme = []')
    expect(answer?.text).toContain('.env.example:1: ACME_REGION=')
    expect(asked).toEqual([])
  })

  test('a search whose glob names the file prints none of its lines, and names it as withheld', async () => {
    const { answers } = await builderCalls([
      { tool: 'search', args: { pattern: WORD, glob: '.env' } },
      { tool: 'search', args: { pattern: WORD, glob: 'config/.env.production' } },
    ])
    const [root, config] = answers
    expect(root?.text).not.toContain(REGION)
    expect(root?.text).toMatch(/(^|[ ,])\.env \(content withheld: sensitive place: [^)]*\.env\)/)
    expect(root?.text).not.toMatch(/^\.env:\d+:/m)
    expect(config?.text).not.toContain(BUCKET)
    expect(config?.text).toMatch(
      /config\/\.env\.production \(content withheld: sensitive place: [^)]*\.env\.production\)/,
    )
    expect(config?.text).not.toMatch(/^config\/\.env\.production:\d+:/m)
  })

  test('a search whose glob only matches the sensitive files prints none of their lines', async () => {
    const { answers } = await builderCalls([
      { tool: 'search', args: { pattern: WORD, glob: '**/.env*' } },
    ])
    const [answer] = answers
    withheldBoth(answer?.text ?? '')
    // The template the same glob matches is read, as fs_read reads it without asking.
    expect(answer?.text).toContain('.env.example:1: ACME_REGION=')
  })
})

describe('fs_read and fs_edit of a sensitive file ask before reading it', () => {
  test('fs_read of a .env and fs_edit of config/.env.production each ask, and neither answer holds a line', async () => {
    const { answers, asked } = await builderCalls([
      { tool: 'fs_read', args: { path: '.env' } },
      {
        tool: 'fs_edit',
        args: { path: 'config/.env.production', edits: [{ old: 'ACME', new: 'ACME' }] },
      },
    ])
    for (const answer of answers) {
      expect(answer.text).not.toContain(REGION)
      expect(answer.text).not.toContain(BUCKET)
    }
    expect(asked.map((one) => one.call.tool)).toEqual(['fs_read', 'fs_edit'])
    expect(asked[0]?.reason).toMatch(/sensitive place: .*\.env/)
    expect(asked[1]?.reason).toMatch(/sensitive place: .*\.env\.production/)
  })
})

describe('A second name of a sensitive file is that file (hard links)', () => {
  /** `notes.txt`, a second name of the `.env` on the disk, made after the commit. */
  const linked = (main: string) => linkSync(join(main, '.env'), join(main, 'notes.txt'))

  test('a search prints no line of notes.txt, a hard link to .env, and names it as withheld', async () => {
    const { answers, asked } = await builderCalls(
      [{ tool: 'search', args: { pattern: WORD } }],
      linked,
    )
    const text = answers[0]?.text ?? ''
    expect(text).not.toContain(REGION)
    expect(text).not.toMatch(/^notes\.txt:\d+:/m)
    expect(text).toMatch(
      /notes\.txt \(content withheld: sensitive place: [^)]*\.env, through a hard link\)/,
    )
    expect(asked).toEqual([])
  })

  test('fs_read of notes.txt, a hard link to .env, asks as fs_read of .env does', async () => {
    const { answers, asked } = await builderCalls(
      [{ tool: 'fs_read', args: { path: 'notes.txt' } }],
      linked,
    )
    expect(answers[0]?.text).not.toContain(REGION)
    expect(asked.map((one) => one.call.tool)).toEqual(['fs_read'])
    expect(asked[0]?.reason).toMatch(/sensitive place: .*\.env, through a hard link/)
  })

  test('a file whose second name no sensitive file shares is searched and read without a question', async () => {
    const { answers, asked } = await builderCalls(
      [
        { tool: 'search', args: { pattern: WORD } },
        { tool: 'fs_read', args: { path: 'copy.ts' } },
      ],
      (main) => linkSync(join(main, 'invoices.ts'), join(main, 'copy.ts')),
    )
    const [search, read] = answers
    expect(search?.text).toContain('copy.ts:1: export const acme = []')
    expect(read?.ok).toBe(true)
    expect(read?.text).toContain('export const acme = []')
    expect(asked).toEqual([])
  })
})

/**
 * Every tool, by what it hands of a file: what it reads from the disk when it is called, what it
 * hands of what was kept before (a checkpoint, a Probe's capture, the evidence), what code it runs
 * printed (masked by the known values; a file that code reads itself is not asked about, the
 * residual of running code), or nothing of a file. A tool that hands a file's content names the scenario that proves a sensitive one is
 * withheld from it, or asked about first. A tool added to the catalogue fails this suite (and the
 * typecheck) until it is put here; one put here as handing content fails it until its scenario
 * exists.
 */
type Hands =
  | {
      readonly hands: 'read' | 'kept' | 'ran'
      /** How the content reaches the sensitive places. */
      readonly how: string
      /** The suite and the test that hold it. */
      readonly proof: { readonly suite: string; readonly test: string }
    }
  | { readonly hands: 'nothing' }

const NOTHING: Hands = { hands: 'nothing' }

const HERE = 'sensitive-content.test.ts'

const CONTENT = {
  fs_read: {
    hands: 'read',
    how: 'the verdict asks on its path (a sensitive place always asks); read through Withholding.asked',
    proof: {
      suite: HERE,
      test: 'fs_read of a .env and fs_edit of config/.env.production each ask, and neither answer holds a line',
    },
  },
  fs_list: NOTHING,
  search: {
    hands: 'read',
    how: 'every file through Withholding.of: a sensitive one is named as withheld',
    proof: {
      suite: HERE,
      test: 'a search with no glob prints no line of .env nor config/.env.production, and names each as withheld',
    },
  },
  fs_write: {
    hands: 'read',
    how: 'the verdict asks on its path; the version compared (and its diff) read through Withholding.asked',
    proof: {
      suite: HERE,
      test: 'fs_read of a .env and fs_edit of config/.env.production each ask, and neither answer holds a line',
    },
  },
  fs_edit: {
    hands: 'read',
    how: 'as fs_write',
    proof: {
      suite: HERE,
      test: 'fs_read of a .env and fs_edit of config/.env.production each ask, and neither answer holds a line',
    },
  },
  commands_list: NOTHING,
  commands_run: {
    hands: 'read',
    how: 'the verdict asks on the sensitive places its line names; their values are masked',
    proof: {
      suite: 'sensitive-reads.test.ts',
      test: 'a command allowed once that prints .env: its run output and its result hold no value',
    },
  },
  commands_output: {
    hands: 'kept',
    how: 'the output of a run that was asked about, masked as commands_run keeps it',
    proof: {
      suite: 'sensitive-reads.test.ts',
      test: 'a command allowed once that prints .env: its run output and its result hold no value',
    },
  },
  commands_stop: NOTHING,
  memory_read: NOTHING,
  now_set: NOTHING,
  journal_add: NOTHING,
  note_add: NOTHING,
  notes_condense: NOTHING,
  evidence_add: {
    hands: 'read',
    how: 'the places rule refuses a sensitive path; the file read through Withholding.of',
    proof: {
      suite: 'memory.test.ts',
      test: 'a path in ~/.ssh, in a .env or in another mission’s folder is refused with its reason',
    },
  },
  missions_list: NOTHING,
  spec_create_draft: NOTHING,
  setup_read: NOTHING,
  setup_propose: NOTHING,
  spec_read: NOTHING,
  spec_write_section: NOTHING,
  requirement_write: NOTHING,
  requirement_remove: NOTHING,
  mission_describe: NOTHING,
  triage_answer: NOTHING,
  declare_complete: NOTHING,
  ask_wave: NOTHING,
  question_retire: NOTHING,
  question_draft_message: NOTHING,
  input_integrated: NOTHING,
  living_spec_read: NOTHING,
  living_domain_propose: NOTHING,
  living_requirement_propose: NOTHING,
  living_requirement_obsolete: NOTHING,
  living_spec_done: NOTHING,
  probe_launch: NOTHING,
  probe_read: {
    hands: 'kept',
    how: 'the capture keeps a sensitive file by its name and fingerprint only',
    proof: {
      suite: 'planning-probes.test.ts',
      test: 'what the preparation wrote is not captured; what the Probe changed of it is',
    },
  },
  probe_report: NOTHING,
  proof_write: NOTHING,
  tasks_write: NOTHING,
  model_recommend: NOTHING,
  discussion_reply: NOTHING,
  discussion_propose_decision: NOTHING,
  ticket_read: NOTHING,
  cold_read_report: NOTHING,
  cold_read_fixed: NOTHING,
  dependency_propose: NOTHING,
  relies_on_write: NOTHING,
  answer_propose: NOTHING,
  ticket_event_report: NOTHING,
  prelaunch_report: NOTHING,
  build_read: NOTHING,
  task_start: NOTHING,
  task_finished: NOTHING,
  task_blocked: NOTHING,
  report_need: NOTHING,
  need_propose: NOTHING,
  proof_run: {
    hands: 'ran',
    how: 'the output of the test it runs, masked by the known values as a run’s output is',
    proof: {
      suite: 'building-proofs.test.ts',
      test: 'a proof whose test prints a known value hands its run back through proof_run masked (#392)',
    },
  },
  build_summary: NOTHING,
  helper_launch: NOTHING,
  helper_read: NOTHING,
  prototype_read: {
    hands: 'read',
    how: 'the kept file read through Withholding.of',
    proof: {
      suite: 'building-prototypes.test.ts',
      test: 'a .env kept by a prototype frozen before the rule is withheld from prototype_read, and none of its lines is printed',
    },
  },
  helper_result: {
    hands: 'read',
    how: 'a Prototyper’s kept files read through Withholding.of, into the evidence',
    proof: {
      suite: 'building-prototypes.test.ts',
      test: 'a Prototyper that keeps a .env is refused, and nothing of it reaches the evidence',
    },
  },
  docs_report: NOTHING,
  checkpoint_read: {
    hands: 'kept',
    how: 'the checkpoint keeps a sensitive file by its name and fingerprint; withheldFromReviewers before any content',
    proof: {
      suite: 'building-end.test.ts',
      test: 'checkpoint_read reads the checkpoint, not a later write in the Workspace; a .env shows "content withheld"',
    },
  },
  evidence_read: {
    hands: 'kept',
    how: 'the evidence holds only what evidence_add and helper_result read through the rule',
    proof: {
      suite: 'building-prototypes.test.ts',
      test: 'a Prototyper that keeps a .env is refused, and nothing of it reaches the evidence',
    },
  },
  review_report: NOTHING,
  hemera_report: NOTHING,
  hemera_reports: NOTHING,
} satisfies Record<ToolName, Hands>

describe('Every tool that hands a file’s content goes through the sensitive places', () => {
  test('every tool of the catalogue says what it hands of a file, and each one that hands content names the test that proves it', () => {
    expect(Object.keys(CONTENT).toSorted()).toEqual([...TOOL_NAMES].toSorted())
    const missing = Object.entries(CONTENT).flatMap(([tool, entry]: [string, Hands]) => {
      if (entry.hands === 'nothing') return []
      const suite = readFileSync(join(import.meta.dirname, entry.proof.suite), 'utf8')
      return suite.includes(entry.proof.test) ? [] : [`${tool}: ${entry.proof.suite}`]
    })
    expect(missing).toEqual([])
  })
})
