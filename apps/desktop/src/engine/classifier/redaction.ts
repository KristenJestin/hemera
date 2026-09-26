/** Redaction before any action or human context leaves the machine (D59-06). */

import { z } from 'zod'

const credentialField = /(?:api[_-]?key|password|passwd|secret|token|credential|authorization)/i
const destinationField = /^(?:path|target|cwd|command|program|line|url|host)$/i
const credentialInText =
  /\b(api[_ -]?key|password|passwd|secret|token|credential|authorization)\s*[:=]\s*([^\s,;]+)/gi
const MASK = '[REDACTED]'

export function redactText(text: string, secrets: readonly string[]): string {
  let redacted = text
  for (const secret of secrets) {
    if (secret !== '') redacted = redacted.replaceAll(secret, MASK)
  }
  return redacted.replace(credentialInText, (_, label: string) => `${label}=${MASK}`)
}

/** Never send a partial action: its structure and destination must survive masking. */
export function redactAction(action: string, secrets: readonly string[]): string | null {
  try {
    // SAFETY: JSON.parse is validated by z.json before the tree is traversed.
    const read = z.json().safeParse(JSON.parse(action))
    if (!read.success || read.data === null || Array.isArray(read.data)) return null
    let lostDestination = false
    const visit = (
      value: z.infer<ReturnType<typeof z.json>>,
      key = '',
    ): z.infer<ReturnType<typeof z.json>> => {
      if (credentialField.test(key)) return MASK
      const string = z.string().safeParse(value)
      if (string.success) {
        const clean = redactText(string.data, secrets)
        if (destinationField.test(key) && clean !== string.data) lostDestination = true
        return clean
      }
      if (Array.isArray(value)) return value.map((item) => visit(item))
      const record = z.record(z.string(), z.json()).safeParse(value)
      if (record.success) {
        return Object.fromEntries(
          Object.entries(record.data).map(([name, item]) => [name, visit(item, name)]),
        )
      }
      return value
    }
    const clean = visit(read.data)
    return lostDestination ? null : JSON.stringify(clean)
  } catch {
    return null
  }
}
