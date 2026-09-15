/**
 * The window of lot 0: a drag strip beside the system's window buttons, and a witness text
 * whose sharpness at a fractional scale is what the lot verifies. The interface itself
 * belongs to lots 1 and 2.
 */

export function Application() {
  return (
    <>
      <header className="title-bar">
        <span>Hemera</span>
        <span>— drag this strip to move the window</span>
      </header>
      <main className="page">
        <h1>Witness text</h1>
        <p>
          Read this line at 100% and at 150%, and compare the edges of the glyphs. Page pixel ratio:{' '}
          {window.devicePixelRatio}.
        </p>
      </main>
    </>
  )
}
