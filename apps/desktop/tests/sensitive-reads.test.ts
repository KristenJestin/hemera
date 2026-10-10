/**
 * A read the user allows on a sensitive place (#74): the values the place holds are masked before
 * anything keeps the result, so they are found in clear nowhere: not in a table, the hidden
 * thread, the trace, a run's output, a backup or any other file of the data folder. The agent
 * still reads the result, its keys whole.
 *
 * The engine is the real one, its agents the fake one over real MCP; data, work and home are
 * temporary folders.
 */

import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { PermissionAnswer } from '@hemera/core/domain'
import { asc, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { AcpTraces } from '../src/engine/agents/trace.ts'
import { answerNeed } from '../src/engine/needs.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { threadOf } from '../src/engine/sessions/thread.ts'
import { Database } from '../src/engine/storage/database.ts'
import { permissionRequests } from '../src/engine/storage/schema.ts'
import { commandsEngine, nodeLine, script, until as polled } from './commands-engine.ts'
import { acmeIn, sessionsEngine, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeWithMission, callTool, sessionOf } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('sensitive-reads'))
  work = realpathSync.native(temporaryFolder('sensitive-reads-work'))
})
afterEach(removeFolders)

/** A value no shape of a credential recognises: only knowing it masks it. */
const REGION = 'quartz-violet-4471'
const DOTENV = `# Acme\nACME_REGION=${REGION}\nexport ACME_BUCKET="amber heron 9083"\n`
const BUCKET = 'amber heron 9083'

const requests = Effect.flatMap(Database, (database) =>
  database.select().from(permissionRequests).orderBy(asc(permissionRequests.number)),
)

const requestNamed = (id: string) =>
  Effect.flatMap(Database, (database) =>
    database.select().from(permissionRequests).where(eq(permissionRequests.id, id)),
  ).pipe(Effect.map(([row]) => row))

const allowOnce = (needId: string) =>
  answerNeed({
    id: needId,
    answer: PermissionAnswer.make({ choice: 'allow-once' }),
    key: crypto.randomUUID(),
  })

/** Every file below a folder. */
const filesBelow = (folder: string): ReadonlyArray<string> =>
  readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .map((name) => join(folder, name))
    .filter((path) => statSync(path).isFile())

/**
 * Where a value is found in clear in the data folder: every row of every table of every database
 * (the Profile and its backups), and the bytes of every other file (traces, logs, outputs).
 */
const foundIn = (value: string): ReadonlyArray<string> =>
  filesBelow(data).flatMap((path) => {
    if (!path.endsWith('.sqlite')) {
      return readFileSync(path).includes(value) ? [path] : []
    }
    const database = new DatabaseSync(path, { readOnly: true })
    try {
      const tables = database
        .prepare("select name from sqlite_master where type = 'table'")
        .all()
        .map((row) => String(row['name']))
      return tables.flatMap((table) =>
        database
          .prepare(`select * from "${table}"`)
          .all()
          .some((row) => JSON.stringify(row).includes(value))
          ? [`${path} ${table}`]
          : [],
      )
    } finally {
      database.close()
    }
  })

describe('An allowed read of a sensitive place leaves its values in clear nowhere', () => {
  test('a held fs_read of .env, allowed once: the result reaches the session masked, and no table, thread, trace or file holds a value', async () => {
    const { run } = sessionsEngine(data, () => ({
      steps: [
        { does: 'uses', id: 'call-env', tool: 'fs_read', arguments: { path: '.env' } },
        { does: 'says', text: 'Waiting for the approval.' },
      ],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* AcpTraces.use((traces) => Effect.sync(() => traces.writing(true)))
          const { owner, main } = yield* acmeIn(work)
          writeFileSync(join(main, '.env'), DOTENV)
          const session = yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'builder', provider: 'claude', folder: main }),
          )
          yield* Sessions.use((sessions) => sessions.settled(session.id))
          const [asked] = yield* requests
          if (asked === undefined) return yield* Effect.die(new Error('no request'))
          yield* allowOnce(asked.needId)
          yield* until(
            Effect.map(threadOf(session.id), (lines) =>
              lines.some((line) => line.kind === 'sent' && line.text.includes('[hemera:approval]')),
            ),
          )
          yield* Sessions.use((sessions) => sessions.settled(session.id))
          return {
            sensitive: asked.sensitive,
            ended: yield* requestNamed(asked.id),
            thread: yield* threadOf(session.id),
          }
        }),
      ),
    )
    expect(seen.sensitive).toBe(true)
    expect(seen.ended).toMatchObject({ result: 'done' })
    const approval = seen.thread.find(
      (line) => line.kind === 'sent' && line.text.includes('[hemera:approval]'),
    )
    expect(approval?.text).toContain('ACME_REGION=•••')
    expect(approval?.text).toContain('export ACME_BUCKET="•••"')
    expect(filesBelow(data).some((path) => path.includes('trace'))).toBe(true)
    expect(foundIn(REGION)).toEqual([])
    expect(foundIn(BUCKET)).toEqual([])
  })

  test('a command allowed once that prints .env: its run output and its result hold no value', async () => {
    const prints = script(`
import { readFileSync } from 'node:fs'
process.stdout.write(readFileSync(process.argv[2], 'utf8'))
`)
    const ended = await commandsEngine(data, { tools: { home: work } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          writeFileSync(join(main, '.env'), DOTENV)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'commands_run', { line: nodeLine(prints, '.env') })
          const [asked] = yield* requests
          if (asked === undefined) return yield* Effect.die(new Error('no request'))
          yield* allowOnce(asked.needId)
          return yield* polled(
            requestNamed(asked.id),
            (row) => row?.state === 'ended' && row.handedOverAt !== null,
          )
        }),
      ),
    )
    expect(ended).toMatchObject({ sensitive: true, result: 'done' })
    expect(ended?.resultText).toContain('ACME_REGION=•••')
    expect(foundIn(REGION)).toEqual([])
    expect(foundIn(BUCKET)).toEqual([])
  })

  test('a .env holding trivial values beside a secret: the trivial ones stay in clear, the secret masked', async () => {
    const prints = script(`
import { readFileSync } from 'node:fs'
process.stdout.write(readFileSync(process.argv[2], 'utf8'))
`)
    const ended = await commandsEngine(data, { tools: { home: work } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          writeFileSync(join(main, '.env'), `ACME_DEBUG=1\nACME_STAGE=dev\n${DOTENV}`)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          yield* callTool(builder.grantId, 'commands_run', { line: nodeLine(prints, '.env') })
          const [asked] = yield* requests
          if (asked === undefined) return yield* Effect.die(new Error('no request'))
          yield* allowOnce(asked.needId)
          return yield* polled(
            requestNamed(asked.id),
            (row) => row?.state === 'ended' && row.handedOverAt !== null,
          )
        }),
      ),
    )
    expect(ended).toMatchObject({ sensitive: true, result: 'done' })
    expect(ended?.resultText).toContain('ACME_DEBUG=1\nACME_STAGE=dev\n')
    expect(ended?.resultText).toContain('ACME_REGION=•••')
    expect(foundIn(REGION)).toEqual([])
    expect(foundIn(BUCKET)).toEqual([])
  })
})
