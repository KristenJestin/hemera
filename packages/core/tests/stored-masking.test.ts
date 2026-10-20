/**
 * #416: an identifier the engine fixes is kept whole in the record it writes, and no known value
 * stands in the stored text of a masked record, across names, values and items.
 */

import { Option, Predicate, Schema } from 'effect'
import * as fc from 'fast-check'
import { describe, expect, test } from 'vite-plus/test'

import {
  MASK,
  NEED_FIXED,
  NeedFields,
  PermissionFields,
  SETTINGS_SECTIONS,
  maskArguments,
  maskRecord,
  maskedJson,
} from '../src/domain/index.ts'

const permission = (settingsSection: string, more: Partial<typeof PermissionFields.Type> = {}) =>
  PermissionFields.make({
    call: 'fs_write notes.md',
    agentReason: 'to write the notes',
    hemeraReason: 'a write outside the Workspace',
    sensitive: false,
    settingsSection,
    ...more,
  })

const readNeed = Schema.decodeUnknownOption(Schema.fromJsonString(NeedFields))

describe('An identifier the engine fixes is kept whole in the record it writes (#416)', () => {
  test('with the variable `hemera`, the permission need keeps `settingsSection: "hemera-auto"`', () => {
    const fields = permission('hemera-auto', { hemeraReason: 'hemera asks' })
    const masked = maskRecord(fields, ['hemera'], NEED_FIXED)
    expect(masked).toMatchObject({ settingsSection: 'hemera-auto', hemeraReason: `${MASK} asks` })
    expect(readNeed(maskedJson(masked))).toEqual(
      Option.some({ ...fields, hemeraReason: `${MASK} asks` }),
    )
  })

  test('every section a need may open is one the engine fixes', () => {
    expect(SETTINGS_SECTIONS).toEqual(
      expect.arrayContaining(['hemera-auto', 'models', 'agents', 'checks']),
    )
  })

  test('a free-text field holding a section id is masked as text', () => {
    const masked = maskRecord(
      permission('hemera-auto', { agentReason: 'see hemera-auto' }),
      ['hemera'],
      NEED_FIXED,
    )
    expect(masked).toMatchObject({
      agentReason: `see ${MASK}-auto`,
      settingsSection: 'hemera-auto',
    })
  })

  test('a path or a call in a need is masked as text, whatever section it names', () => {
    const masked = maskRecord(
      permission('hemera-auto', { call: 'fs_write hemera-auto', asked: 'Write hemera-auto' }),
      ['hemera'],
      NEED_FIXED,
    )
    expect(masked).toMatchObject({ call: `fs_write ${MASK}-auto`, asked: `Write ${MASK}-auto` })
  })

  test('the fixed field holding a value off the list is masked as text', () => {
    const masked = maskRecord(permission('hemera-private'), ['hemera'], NEED_FIXED)
    expect(masked).toMatchObject({ settingsSection: `${MASK}-private` })
  })

  test('a field of the same name nested in the record, or the items it lists, are masked as text', () => {
    const masked = maskRecord(
      { nested: { settingsSection: 'hemera-auto' }, settingsSection: ['hemera-auto'] },
      ['hemera'],
      NEED_FIXED,
    )
    expect(masked).toEqual({
      nested: { settingsSection: `${MASK}-auto` },
      settingsSection: [`${MASK}-auto`],
    })
  })

  test('a field added later without classification is masked as text', () => {
    const masked = maskRecord(
      { ...permission('hemera-auto'), section: 'hemera-auto', sectionId: 'hemera-auto' },
      ['hemera'],
      NEED_FIXED,
    )
    expect(masked).toMatchObject({
      settingsSection: 'hemera-auto',
      section: `${MASK}-auto`,
      sectionId: `${MASK}-auto`,
    })
  })

  test('a record masked without its list keeps no identifier in clear', () => {
    expect(maskRecord(permission('hemera-auto'), ['hemera'])).toMatchObject({
      settingsSection: `${MASK}-auto`,
    })
  })

  test("an agent's argument named like a fixed field is masked as text", () => {
    expect(
      maskArguments({ settingsSection: 'hemera-auto', id: 'hemera-auto' }, ['hemera']),
    ).toEqual({
      settingsSection: `${MASK}-auto`,
      id: `${MASK}-auto`,
    })
  })

  test('a known value equal to a fixed literal is kept only where the schema fixes it', () => {
    const masked = maskRecord(
      permission('hemera-auto', { agentReason: 'hemera-auto' }),
      ['hemera-auto'],
      NEED_FIXED,
    )
    expect(masked).toMatchObject({ settingsSection: 'hemera-auto', agentReason: MASK })
  })
})

/** A record masked as the engine stores it, and the record it reads back. */
const stored = (record: Schema.JsonObject, known: ReadonlyArray<string>) =>
  maskedJson(maskRecord(record, known))
const storedArguments = (record: Schema.JsonObject, known: ReadonlyArray<string>) =>
  maskedJson(maskArguments(record, known))

describe('No known value stands in the stored text of a masked record (#416)', () => {
  const spanning = 'a":"b'
  const cases: ReadonlyArray<readonly [string, Schema.JsonObject, string]> = [
    ['a name and its value', { 'zz a': 'b zz' }, spanning],
    ['two items of a list', { list: ['zz a', 'b zz'] }, 'a","b'],
    ['a value and the next name', { one: 'zz a', 'b two': 'x' }, 'a","b'],
    ['a value, a name and the next value', { one: 'zz a', b: 'c zz' }, 'a","b":"c'],
    ['nested records', { one: { two: 'zz a' }, three: 'b zz' }, 'a"},"three":"b'],
    ['an escaped quote', { one: 'zz a"b zz' }, String.raw`a\"b`],
    ['a unicode escape', { one: 'zz a\u0001b zz' }, String.raw`a\u0001b`],
    ['an escaped backslash', { one: String.raw`zz a\b zz` }, String.raw`a\\b`],
  ]
  for (const [label, record, known] of cases) {
    test(`with a registered \`${known}\` across ${label}, the stored record does not show it`, () => {
      expect(JSON.stringify(record)).toContain(known)
      const text = stored(record, [known])
      expect(text).not.toContain(known)
      expect(Object.keys(JSON.parse(text))).toEqual(Object.keys(record))
    })
    test(`with a registered \`${known}\` across ${label}, the stored arguments do not show it`, () => {
      const text = storedArguments(record, [known])
      expect(text).not.toContain(known)
      expect(() => JSON.parse(text)).not.toThrow()
    })
  }

  test('with a registered `a":"b`, neither `{"zz a":"b zz"}` nor `["zz a","b zz"]` shows it', () => {
    expect(stored({ 'zz a': 'b zz' }, [spanning])).toBe(`{"zz a":"${MASK}"}`)
    expect(stored({ list: ['zz a', 'b zz'] }, ['a","b'])).toBe(`{"list":["${MASK}","${MASK}"]}`)
  })

  test("an agent's names that a known value spans are masked as text", () => {
    const text = storedArguments({ 'zz a': 1, 'b zz': 2 }, ['a":1,"b'])
    expect(text).not.toContain('a":1,"b')
    expect(Object.values(JSON.parse(text))).toEqual([1, 2])
  })

  test('a need masked across its fields is stored as JSON and read back', () => {
    const fields = permission('hemera-auto')
    const known = 'notes","hemeraReason":"a write'
    expect(JSON.stringify(fields)).toContain(known)
    const text = maskedJson(maskRecord(fields, [known], NEED_FIXED))
    expect(text).not.toContain(known)
    expect(readNeed(text)).toEqual(
      Option.some({ ...fields, agentReason: MASK, hemeraReason: MASK }),
    )
  })

  test('a known value holding the mask is masked across what masking wrote', () => {
    const known = `${MASK}","c`
    const text = stored({ list: ['zz a', 'b q', 'c zz'] }, ['a","b', known])
    expect(text).not.toContain(known)
    expect(text).not.toContain('a","b')
  })
})

/** Names as a schema writes them: words, never one that says credential. */
const name = fc
  .stringMatching(/^[a-zA-Z ]{1,8}$/)
  .filter(
    (word) => !/api[_-]?key|password|passwd|secret|token|credential|authorization/i.test(word),
  )
const shaped: fc.Arbitrary<Schema.Json> = fc.letrec<{ value: Schema.Json }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small' },
    fc.string({ maxLength: 8 }),
    fc.string({ maxLength: 8, unit: 'binary' }),
    fc.integer(),
    fc.array(tie('value'), { maxLength: 3 }),
    fc.dictionary(name, tie('value'), { maxKeys: 3 }),
  ),
})).value

/** The record with each of its strings (never a name) as `MASK`: what masking may not write over. */
const skeletonOf = (value: Schema.Json, names: boolean): Schema.Json => {
  if (Predicate.isString(value)) return MASK
  if (Array.isArray(value)) return value.map((item) => skeletonOf(item, names))
  if (value === null || Predicate.isNumber(value) || Predicate.isBoolean(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item], at) => [
      names ? `${MASK}${String(at)}` : key,
      skeletonOf(item, names),
    ]),
  )
}

describe('For any record and any known value, the stored text never shows it (#416)', () => {
  const property = (
    mask: (record: Schema.JsonObject, known: ReadonlyArray<string>) => string,
    names: boolean,
  ) =>
    fc.property(
      fc.dictionary(name, shaped, { minKeys: 1, maxKeys: 4 }),
      fc.nat(),
      fc.integer({ min: 2, max: 24 }),
      (record, from, length) => {
        const whole = JSON.stringify(record)
        const start = from % whole.length
        const known = whole.slice(start, start + length)
        if (known.length < 2) return
        const text = mask(record, [known])
        expect(Object.keys(JSON.parse(text))).toHaveLength(Object.keys(record).length)
        if (!JSON.stringify(skeletonOf(record, names)).includes(known)) {
          expect(text).not.toContain(known)
        }
      },
    )

  test('a record the engine builds', () => {
    fc.assert(property(stored, false), { numRuns: 3_000 })
  })

  test("an agent's arguments", () => {
    fc.assert(property(storedArguments, true), { numRuns: 3_000 })
  })
})

const timed = (run: () => void, times: number): number => {
  const start = performance.now()
  for (let round = 0; round < times; round += 1) run()
  return performance.now() - start
}

/** How much longer masking a record 16 times as large takes, at its fastest. */
const growth = (make: (size: number) => Schema.JsonObject, size: number, known: string) => {
  const small = make(size)
  const large = make(16 * size)
  let times = 1
  while (timed(() => stored(small, [known]), times) < 20) times *= 2
  let fastestSmall = Number.POSITIVE_INFINITY
  let fastestLarge = Number.POSITIVE_INFINITY
  for (let round = 0; round < 7; round += 1) {
    fastestSmall = Math.min(
      fastestSmall,
      timed(() => stored(small, [known]), times),
    )
    fastestLarge = Math.min(
      fastestLarge,
      timed(() => stored(large, [known]), times),
    )
  }
  return fastestLarge / fastestSmall
}

describe('Checking the stored text of a record takes time in proportion to its size (#416)', () => {
  test('16 times as many fields a known value spans take less than 64 times as long', () => {
    const fields = (width: number) =>
      Object.fromEntries(
        Array.from({ length: width }, (_, index) => [`k${String(index)} a`, `b v${String(index)}`]),
      )
    expect(growth(fields, 500, 'a":"b')).toBeLessThan(64)
  }, 600_000)

  test('16 times as many items a known value spans take less than 64 times as long', () => {
    const items = (width: number) => ({
      list: Array.from({ length: width }, (_, index) => `b v${String(index)} a`),
    })
    expect(growth(items, 500, 'a","b')).toBeLessThan(64)
  }, 600_000)

  test('a string 16 times as long, spanned at both ends, takes less than 64 times as long', () => {
    const long = (width: number) => ({ one: `x a`, two: `b ${'y '.repeat(width)} a`, three: 'b z' })
    expect(growth(long, 4_000, 'a","t')).toBeLessThan(64)
  }, 600_000)
})
