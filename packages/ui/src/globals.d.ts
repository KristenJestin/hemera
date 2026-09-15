/**
 * The two globals the design system uses of the runtime around it.
 *
 * It declares no environment — not Bun, not the DOM — so that nothing here can quietly
 * reach for a file, a process or a network call. A delayed callback is the exception: an
 * exit animation has to outlive the state that ended it, and every JavaScript runtime has
 * these two.
 */

declare function setTimeout(callback: () => void, milliseconds: number): number
declare function clearTimeout(handle: number): void
