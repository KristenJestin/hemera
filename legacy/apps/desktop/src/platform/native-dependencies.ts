/**
 * What to say when the renderer addon cannot be loaded.
 *
 * The napi loader answers a failed `dlopen` with the same sentence whatever the cause: that
 * the native binding is missing and that npm has a bug with optional dependencies. On a
 * machine that is only missing a system library, that names the wrong culprit and sends the
 * reader to reinstall packages that are already there. The loader keeps the real failure in
 * the `cause` chain, so the library is read from there and named.
 */

/** A shared object, as the dynamic loader names it in its failures. */
const SHARED_OBJECT = /([\w.+-]+\.so(?:\.\d+)*)/

/** Messages of the error and of everything it was caused by, outermost first. */
function causeChain(error: unknown): string[] {
  const messages: string[] = []
  let current: unknown = error
  // A cycle in the chain would otherwise spin here; the depth also bounds a very long one.
  for (let depth = 0; current !== null && current !== undefined && depth < 16; depth += 1) {
    if (Array.isArray(current)) {
      for (const entry of current) messages.push(...causeChain(entry))
      return messages
    }
    if (current instanceof Error) {
      messages.push(current.message)
      current = current.cause
      continue
    }
    if (typeof current === 'string') messages.push(current)
    return messages
  }
  return messages
}

/**
 * The system library a failed load blames, or null when the failure is about something else.
 *
 * A package that cannot run for want of a library says which one, so the reader can install
 * it instead of reinstalling the application.
 */
export function missingLibraryDiagnostic(error: unknown): string | null {
  for (const message of causeChain(error)) {
    const found = SHARED_OBJECT.exec(message)
    if (found === null) continue
    return (
      `the renderer could not load ${found[1]}: ${message.trim()}. ` +
      'Install it from your distribution; the libraries this package needs are listed in ' +
      'SYSTEM-REQUIREMENTS.md beside the executable.'
    )
  }
  return null
}
