import { useEffect, useRef, useState } from 'react'

import { sentenceOf } from './settings-refusals.ts'

/** How long typing in a field of the Workspaces waits before it is written. */
export const TYPING_SETTLES_MS = 600

/**
 * The lines the engine was asked about, and what it refused in each: what a line field shows as
 * it is typed, the token named.
 */
export function useLineChecks(
  check: (line: string) => Promise<string | null>,
  lines: ReadonlyArray<string>,
): (line: string) => string | undefined {
  const [checked, setChecked] = useState<ReadonlyMap<string, string | null>>(new Map())
  const asked = useRef(new Set<string>())
  const wanted = lines.filter((line) => line.trim() !== '').join('\n')
  useEffect(() => {
    for (const line of wanted.split('\n')) {
      if (line === '' || asked.current.has(line)) continue
      asked.current.add(line)
      // react-doctor-disable-next-line no-pass-data-to-parent -- a request to the engine, whose answer comes back into this hook
      check(line).then(
        (problem) => setChecked((before) => new Map(before).set(line, problem)),
        () => asked.current.delete(line),
      )
    }
  }, [check, wanted])
  return (line) => checked.get(line) ?? undefined
}

/** The Workspaces fields: what is typed, written once the typing settles. */
export function useSettled(
  saved: string | null,
  write: (value: string | null) => Promise<void>,
): [string | null, (value: string | null) => void, string | undefined] {
  const [value, setValue] = useState(saved)
  const [error, setError] = useState<string | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typing = useRef(false)
  const writeNow = (next: string | null): void => {
    typing.current = false
    write(next).then(
      () => setError(undefined),
      (failure: Error) => setError(sentenceOf(failure)),
    )
  }
  // A value changed elsewhere is taken, unless the user is typing in the field.
  // react-doctor-disable-next-line no-derived-state-effect -- the field's own copy, which typing keeps apart from what is saved
  useEffect(() => {
    // react-doctor-disable-next-line no-derived-state -- the same copy
    if (!typing.current) setValue(saved)
  }, [saved])
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  const change = (next: string | null): void => {
    setValue(next)
    typing.current = true
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => writeNow(next), TYPING_SETTLES_MS)
  }
  return [value, change, error]
}
