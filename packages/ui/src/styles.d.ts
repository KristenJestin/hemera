/** A stylesheet imported for its effect: the bundler injects it, the type system is told so. */
declare module '*.css' {
  const stylesheet: string
  export default stylesheet
}

/** A stylesheet imported for its text: the theme, read by the process that paints the frame. */
declare module '*.css?raw' {
  const source: string
  export default source
}
