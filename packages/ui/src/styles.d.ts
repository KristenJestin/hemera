/** A stylesheet imported for its effect: the bundler injects it, the type system is told so. */
declare module '*.css' {
  const stylesheet: string
  export default stylesheet
}
