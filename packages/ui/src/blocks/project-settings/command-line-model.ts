import type { CommandLineValue } from './command-line.tsx'

/** A line with nothing in it yet. */
export const EMPTY_LINE: CommandLineValue = {
  command: null,
  line: '',
  lineLinux: null,
  lineWindows: null,
}
