import { type ReactNode, useState } from 'react'

import { Frame } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { Select } from '../../components/select/select.tsx'
import { COMMITS } from '../../blocks/project-settings/delivery-forms.tsx'
import type { WhoCommits } from '../../blocks/project-settings/delivery-model.ts'

/**
 * Open question 26, the alternative: who commits chosen in the line itself, with no dialog, and
 * the history it gives always shown under it. Rejected variants are removed before the merge.
 */
export function InlineCommits({
  histories,
}: {
  histories: Readonly<Record<WhoCommits, readonly string[]>>
}): ReactNode {
  const [value, setValue] = useState<WhoCommits>('task')
  const chosen = COMMITS.find((one) => one.value === value)
  return (
    <section aria-label="Delivery rules" className="flex flex-col gap-3">
      <SectionHead title="Delivery rules" />
      <Frame>
        <h3 className="flex h-control-sm items-center gap-2 border-b border-border bg-surface-rim px-4 text-xs font-medium">
          Pull requests <span className="font-normal text-muted-foreground">· before Ship</span>
        </h3>
        <div className="flex min-h-control-lg items-center gap-3 px-4 py-2 text-sm">
          <span className="w-settings-name shrink-0 font-medium">Who commits</span>
          <Select<WhoCommits>
            label="Who commits"
            className="w-picker"
            value={value}
            onValueChange={setValue}
            items={COMMITS.map((one) => ({ value: one.value, label: one.label }))}
          />
        </div>
        <div className="flex flex-col gap-1 border-t border-border px-4 py-2">
          <span className="text-xs text-muted-foreground">{chosen?.effect}</span>
          <ol
            aria-label="History of api after ACME-12"
            className="flex flex-col font-mono text-xs text-muted-foreground"
          >
            {histories[value].map((line) => (
              <li key={line} className="truncate">
                {line}
              </li>
            ))}
          </ol>
        </div>
      </Frame>
    </section>
  )
}
