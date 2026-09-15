/**
 * Font files imported as resources.
 *
 * The bundler turns each of them into a path it can read at runtime, embedded in the
 * assembled executable; TypeScript only needs to know that the import is a path.
 */
declare module '*.ttf' {
  const path: string
  export default path
}
