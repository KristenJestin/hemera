/** A body for a view, with the lines a story needs to scroll. */
export function Prose({
  title,
  lines,
  wide = false,
}: {
  title: string
  lines: number
  wide?: boolean
}) {
  return (
    <div
      className={
        wide ? 'flex flex-col gap-3 px-6 py-5' : 'flex max-w-measure flex-col gap-3 px-6 py-5'
      }
    >
      <p className="text-sm text-muted-foreground">{title}</p>
      {Array.from({ length: lines }, (_, index) => (
        <p key={index} className="text-base">
          Line {index + 1} of the view, written by the agent and read here; what it says is a later
          ticket's, its width and its scroll are this one's.
        </p>
      ))}
    </div>
  )
}
