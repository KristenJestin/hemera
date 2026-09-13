/**
 * Timer functions every JavaScript host provides.
 *
 * The design system compiles without the DOM library and without the Bun ambient types, so
 * the two functions it needs are declared here rather than pulling a whole platform library
 * into a package that must stay free of them.
 */

declare function setInterval(handler: () => void, timeout: number): number
declare function clearInterval(id: number): void
