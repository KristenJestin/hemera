/**
 * What a Chat's page and its sidebar row ask the engine (#52), with no window: a press goes once
 * while the last one is on its way, and what the engine refuses is said in words.
 */

import { ApplicationOwner, EnvironmentFields } from '@hemera/core/domain'
import type { ChatLine, ChatSummary, ModelMark, Need } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import { chatActions, flight, markedAs, startChat } from '../src/renderer/chat-actions.ts'
import type { Link } from '../src/renderer/link.ts'
import { SILENT_LINK } from './fake-link.ts'

/** A call the test settles by hand. */
const pending = <A>() => {
  let settle: { resolve: (value: A) => void; reject: (failure: Error) => void } | null = null
  const promise = new Promise<A>((resolve, reject) => {
    settle = { resolve, reject }
  })
  return {
    promise,
    // SAFETY: the executor above ran synchronously, so `settle` is set.
    resolve: (value: A) => settle!.resolve(value),
    // SAFETY: as above.
    reject: (failure: Error) => settle!.reject(failure),
  }
}

/** Lets the promises settled so far run their reactions. */
const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

const LINE: ChatLine = {
  sequence: 1,
  kind: 'user',
  text: 'Where are the invoices exported?',
  tool: null,
  outcome: null,
  request: null,
  held: null,
  at: '2026-10-07T08:00:00.000Z',
}

const NEED: Need = {
  id: 'need-1',
  owner: ApplicationOwner.make({}),
  fields: EnvironmentFields.make({
    missing: 'Docker is not running',
    action: 'Start Docker',
    settingsSection: null,
  }),
  choices: [],
  requestedBy: null,
  state: 'answered',
  answer: null,
  endedReason: null,
  createdAt: '2026-10-07T08:00:00.000Z',
  endedAt: null,
}

const refused = (sentence: string) => () => Promise.reject(new Error(sentence))

/** A page's actions over `link`, with what they said and how often the Chat was read again. */
const page = (link: Partial<Link>) => {
  const said: Array<string | null> = []
  let rereads = 0
  let remarks = 0
  const actions = chatActions({
    link: { ...SILENT_LINK, ...link },
    chatId: 'chat-1',
    sending: flight(),
    say: (sentence) => said.push(sentence),
    reread: () => {
      rereads += 1
    },
    remarked: () => {
      remarks += 1
    },
  })
  return { actions, said, rereads: () => rereads, remarks: () => remarks }
}

describe('A message sent from a Chat’s page', () => {
  test('Enter pressed twice while the Chat’s session starts sends it once', async () => {
    const sent: string[] = []
    const answer = pending<ChatLine>()
    const { actions } = page({
      sendToChat: (_chatId, text) => {
        sent.push(text)
        return answer.promise
      },
    })
    expect(actions.send('Where are the invoices exported?', [], () => undefined)).toBe(true)
    expect(actions.send('Where are the invoices exported?', [], () => undefined)).toBe(false)
    answer.resolve(LINE)
    await settled()
    expect(sent).toEqual(['Where are the invoices exported?'])
    expect(actions.send('And the receipts?', [], () => undefined)).toBe(true)
    expect(sent).toHaveLength(2)
  })

  test('a message the engine refuses is said, and its text handed back to the draft', async () => {
    const back: string[] = []
    const { actions, said } = page({ sendToChat: refused('The Chat’s agent is not installed.') })
    actions.send('Where are the invoices exported?', [], (text) => back.push(text))
    await settled()
    expect(said.at(-1)).toBe('The Chat’s agent is not installed.')
    expect(back).toEqual(['Where are the invoices exported?'])
  })
})

describe('What a Chat’s page could not do is said in words', () => {
  test('a Stop the engine refuses', async () => {
    const { actions, said } = page({ stopChat: refused('Hemera could not reach the agent.') })
    actions.stop()
    await settled()
    expect(said.at(-1)).toBe('The agent could not be stopped: Hemera could not reach the agent.')
  })

  test('a model the engine refuses', async () => {
    const { actions, said } = page({ setChatModel: refused('This Chat no longer exists.') })
    actions.setModel({ agent: 'claude', model: 'large', effort: null })
    await settled()
    expect(said.at(-1)).toBe('The model could not be changed: This Chat no longer exists.')
  })

  test('a name the engine refuses', async () => {
    const { actions, said } = page({ renameChat: refused('This Chat no longer exists.') })
    actions.rename('Invoices export')
    await settled()
    expect(said.at(-1)).toBe('The Chat could not be renamed: This Chat no longer exists.')
  })

  test('an answer to a held call the engine refuses, and the Chat read again', async () => {
    const { actions, said, rereads } = page({ answerNeed: refused('This call was answered.') })
    actions.answer('need-1', 'allow')
    await settled()
    expect(said.at(-1)).toBe('Your answer could not be given: This call was answered.')
    expect(rereads()).toBe(1)
  })

  test('an answer taken reads the Chat again and says nothing', async () => {
    const { actions, said, rereads } = page({
      answerNeed: () => Promise.resolve(NEED),
    })
    actions.answer('need-1', 'deny')
    await settled()
    expect(said.filter((sentence) => sentence !== null)).toEqual([])
    expect(rereads()).toBe(1)
  })
})

describe('A model marked from a Chat’s picker', () => {
  const MARKS = [{ agent: 'claude', model: 'large', favourite: false, hidden: true }] as const

  test('a star keeps what else the model was marked, and the marks are read again', async () => {
    const marked: ModelMark[] = []
    const { actions, remarks } = page({
      markModel: (mark) => {
        marked.push(mark)
        return Promise.resolve()
      },
    })
    actions.mark(markedAs(MARKS, 'claude', 'large', { favourite: true }))
    actions.mark(markedAs(MARKS, 'claude', 'small', { hidden: true }))
    await settled()
    expect(marked).toEqual([
      { agent: 'claude', model: 'large', favourite: true, hidden: true },
      { agent: 'claude', model: 'small', favourite: false, hidden: true },
    ])
    expect(remarks()).toBe(2)
  })

  test('a mark the engine refuses is said in words', async () => {
    const { actions, said } = page({ markModel: refused('Hemera could not write to its profile.') })
    actions.mark(markedAs([], 'claude', 'large', { favourite: true }))
    await settled()
    expect(said.at(-1)).toBe(
      'The model could not be marked: Hemera could not write to its profile.',
    )
  })
})

describe('"New Chat" in the sidebar', () => {
  const CHAT: ChatSummary = {
    id: 'chat-2',
    projectId: 'acme',
    title: 'New Chat',
    setting: { agent: 'claude', model: null, effort: null },
    createdAt: '2026-10-07T08:00:00.000Z',
    lastActivityAt: '2026-10-07T08:00:00.000Z',
    working: false,
  }

  test('a double click creates one Chat, and opens it', async () => {
    let created = 0
    const answer = pending<ChatSummary>()
    const link = {
      ...SILENT_LINK,
      createChat: () => {
        created += 1
        return answer.promise
      },
    }
    const busy: boolean[] = []
    const creating = flight((now) => busy.push(now))
    const opened: string[] = []
    const said: Array<string | null> = []
    startChat(
      link,
      'acme',
      creating,
      (id) => opened.push(id),
      (sentence) => said.push(sentence),
    )
    startChat(
      link,
      'acme',
      creating,
      (id) => opened.push(id),
      (sentence) => said.push(sentence),
    )
    answer.resolve(CHAT)
    await settled()
    expect(created).toBe(1)
    expect(opened).toEqual(['chat-2'])
    expect(busy).toEqual([true, false])
  })

  test('a Chat the engine could not create is said in words', async () => {
    const said: Array<string | null> = []
    startChat(
      { ...SILENT_LINK, createChat: refused('Hemera could not write to its profile.') },
      'acme',
      flight(),
      () => undefined,
      (sentence) => said.push(sentence),
    )
    await settled()
    expect(said.at(-1)).toBe(
      'The Chat could not be started: Hemera could not write to its profile.',
    )
  })
})
