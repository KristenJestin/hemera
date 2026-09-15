/**
 * Channel the assembler writes into the bundle.
 *
 * It only exists in an assembled package; a run from the sources never defines it, which is
 * how a development run is told apart from an installed one.
 */
declare const HEMERA_PACKAGED_CHANNEL: string | undefined
