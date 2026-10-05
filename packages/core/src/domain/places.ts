/**
 * Where a call points: the paths a command names, read through the shell strings it hands on, and
 * the places that always ask, whatever any judge says.
 *
 * A call that runs from the Workspace is not a call that stays in it: `cat ~/.ssh/config` runs in
 * the Project's folder and reads a key. What decides inside or outside is every path the call
 * names, and what cannot be read with certainty is outside. This reads words, never the disk: the
 * caller resolves what is handed back, links included.
 */

/** What the words of a command are read against: whose home `~` is, and on which system. */
export interface PlaceContext {
  readonly home: string
  /** The name of the user Hemera runs as, so `~<user>` is the home. */
  readonly user: string
  readonly platform: string
}

/** The paths a command names, as written or expanded, and why its words did not read, if not. */
export interface NamedPlaces {
  /** Relative paths are relative to the folder the command runs in. */
  readonly paths: ReadonlyArray<string>
  /**
   * Every command the line would start, as words, the program first: the line itself, and each
   * command of every string it hands to a shell, as that shell splits it.
   */
  readonly commands: ReadonlyArray<ReadonlyArray<string>>
  /** Null when every word read with certainty; otherwise what could not be read. */
  readonly unreadable: string | null
}

/** Why a call always asks: it points outside the role's place, or at a sensitive place. */
export interface PlaceConcern {
  readonly kind: 'outside' | 'sensitive'
  /** The place as the human is shown it: `~/.ssh/config`, or what could not be read. */
  readonly place: string
}

/** The reason a decision records and the question says; `placeName` is the role's place. */
export function concernSaid(concern: PlaceConcern, placeName = 'the Workspace'): string {
  return concern.kind === 'outside'
    ? `outside ${placeName}: ${concern.place}`
    : `sensitive place: ${concern.place}`
}

// ---------------------------------------------------------------------------------------------
// The sensitive places.

/** One segment of a sensitive place: a name, or every name that starts with a prefix. */
type Segment = { readonly name: string } | { readonly prefix: string }

interface SensitiveEntry {
  /** As the list says it. */
  readonly listed: string
  /** Its segments, found anywhere along a path unless `anchored` to the root. */
  readonly segments: readonly Segment[]
  readonly anchored?: boolean
}

const named = (...names: readonly string[]): Segment[] => names.map((name) => ({ name }))

/**
 * The sensitive places: credentials, keys and Hemera's own data. Read or written, through a file
 * tool or a command, they always ask. A home's entry is matched wherever the folder sits, so
 * another user's `~/.ssh` is as sensitive as this one's.
 */
export const SENSITIVE_PLACES: readonly SensitiveEntry[] = [
  { listed: '~/.ssh', segments: named('.ssh') },
  { listed: '~/.gnupg', segments: named('.gnupg') },
  { listed: '~/.aws', segments: named('.aws') },
  { listed: '~/.azure', segments: named('.azure') },
  { listed: '~/.config/gcloud', segments: named('.config', 'gcloud') },
  { listed: '~/.kube', segments: named('.kube') },
  { listed: '~/.docker/config.json', segments: named('.docker', 'config.json') },
  { listed: '~/.config/gh', segments: named('.config', 'gh') },
  { listed: '~/.netrc', segments: named('.netrc') },
  { listed: '~/.npmrc', segments: named('.npmrc') },
  { listed: '~/.pypirc', segments: named('.pypirc') },
  { listed: '~/.git-credentials', segments: named('.git-credentials') },
  { listed: '~/.local/share/keyrings', segments: named('.local', 'share', 'keyrings') },
  { listed: '~/Library/Keychains', segments: named('Library', 'Keychains') },
  { listed: '~/.hemera', segments: named('.hemera') },
  { listed: '~/.hemera-dev', segments: named('.hemera-dev') },
  { listed: '/etc/shadow', segments: named('etc', 'shadow'), anchored: true },
  { listed: '/etc/sudoers', segments: named('etc', 'sudoers'), anchored: true },
  { listed: '/etc/sudoers.d', segments: named('etc', 'sudoers.d'), anchored: true },
  { listed: '.env', segments: named('.env') },
  { listed: '.env.*', segments: [{ prefix: '.env.' }] },
]

/** Whether names differ only by case on this system. */
const foldsCase = (platform: string) => platform === 'win32' || platform === 'darwin'

/** A segment that holds a glob, as the expression of the names it matches. */
function globOf(segment: string): RegExp | null {
  if (!/[*?[]/.test(segment)) return null
  let source = ''
  for (const character of segment) {
    if (character === '*') source += '.*'
    else if (character === '?') source += '.'
    else if (character === '[' || character === ']') source += character
    else source += character.replace(/[.+^${}()|\\]/g, '\\$&')
  }
  try {
    return new RegExp(`^${source}$`, 'i')
  } catch {
    return /^.*$/
  }
}

/** Whether a segment of a path — a name, or a glob that may name it — is this entry's segment. */
function segmentIs(written: string, segment: Segment, platform: string): boolean {
  const fold = foldsCase(platform)
  const name = fold ? written.toLowerCase() : written
  const glob = globOf(written)
  if ('name' in segment) {
    const wanted = fold ? segment.name.toLowerCase() : segment.name
    if (glob === null) return name === wanted
    // A shell's glob does not match a leading dot unless it writes one; Windows' does.
    if (platform !== 'win32' && wanted.startsWith('.') && !written.startsWith('.')) return false
    return glob.test(wanted)
  }
  const prefix = segment.prefix
  if (glob === null) return name.startsWith(prefix) && name.length > prefix.length
  if (platform !== 'win32' && !written.startsWith('.')) return false
  return glob.test(`${prefix}local`)
}

/** A path's segments, whichever separator it is written with. */
function segmentsOf(path: string): string[] {
  return path.split(/[\\/]+/)
}

/**
 * The sensitive place a path is in, shown from the home when it is under it, and null when it is
 * in none. `path` is absolute; a segment that is a glob counts when it may name the place.
 */
export function sensitivePlace(
  path: string,
  context: Pick<PlaceContext, 'home' | 'platform'>,
): string | null {
  const parts = segmentsOf(path)
  for (const entry of SENSITIVE_PLACES) {
    const length = entry.segments.length
    const starts = entry.anchored === true ? [1] : parts.map((_, at) => at)
    for (const start of starts) {
      if (start + length > parts.length) continue
      const matches = entry.segments.every((segment, at) =>
        segmentIs(parts[start + at] ?? '', segment, context.platform),
      )
      if (!matches) continue
      if (entry.anchored === true && parts[0] !== '') continue
      return shownFromHome(prefixOf(path, start + length), context)
    }
  }
  return null
}

/** The first `count` segments of a path, as it spells them. */
function prefixOf(path: string, count: number): string {
  let seen = 0
  let at = 0
  for (; at < path.length; at += 1) {
    const character = path[at]
    if (character === '/' || character === '\\') {
      seen += 1
      if (seen === count) break
      while (path[at + 1] === '/' || path[at + 1] === '\\') at += 1
    }
  }
  return path.slice(0, at)
}

/** A path under the home, written from `~`, as the human reads it. */
export function shownFromHome(
  path: string,
  context: Pick<PlaceContext, 'home' | 'platform'>,
): string {
  const fold = foldsCase(context.platform)
  const home = context.home.replace(/[\\/]+$/, '')
  const same = (left: string, right: string) =>
    fold ? left.toLowerCase() === right.toLowerCase() : left === right
  if (home === '') return path
  if (same(path, home)) return '~'
  const next = path[home.length]
  if ((next === '/' || next === '\\') && same(path.slice(0, home.length), home)) {
    return `~${path.slice(home.length)}`
  }
  return path
}

// ---------------------------------------------------------------------------------------------
// The words of a command, and of the strings it hands to a shell.

type Dialect = 'posix' | 'cmd' | 'powershell'

/** A program's name without its folder, its case on Windows, or an executable extension. */
function programName(program: string): string {
  const base = program.replaceAll('\\', '/').split('/').at(-1) ?? ''
  return base.toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/, '')
}

const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish'])
const POWERSHELLS = new Set(['powershell', 'pwsh'])
/** What changes the folder, and goes home when it names none. */
const CHANGES_FOLDER = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl'])
/** PowerShell's options that take a value, so the value is not taken for the command. */
const POWERSHELL_VALUES = new Set([
  'executionpolicy',
  'ex',
  'ep',
  'windowstyle',
  'w',
  'outputformat',
  'o',
  'of',
  'inputformat',
  'if',
  'configurationname',
  'workingdirectory',
  'wd',
  'settingsfile',
  'custompipename',
  'psconsolefile',
  'version',
  'v',
])

/**
 * Whether a word hands code to an interpreter inline: `python -c`, `node -e`, `perl -ne`… That
 * code is not a shell's, and what it opens cannot be read from it.
 */
function inlineCode(name: string, flag: string): boolean {
  if (/^(?:python[0-9.]*|py|pypy[0-9.]*)$/.test(name)) return /^-[A-Za-z]*c$/.test(flag)
  if (name === 'node' || name === 'nodejs' || name === 'bun') {
    return /^(?:-e|-p|-pe|--eval|--print)(?:=.*)?$/.test(flag)
  }
  if (name === 'deno') return flag === 'eval'
  if (name === 'perl' || name === 'ruby') return /^-[A-Za-z]*[eE][A-Za-z]*$/.test(flag)
  if (name === 'php') return flag === '-r'
  if (name === 'osascript' || name === 'rscript' || name === 'lua') return flag === '-e'
  return false
}

/** What reading goes on from: the context, how deep in strings it is, and what it found. */
interface Reading {
  readonly context: PlaceContext
  readonly paths: string[]
  readonly commands: Array<ReadonlyArray<string>>
  unreadable: string | null
}

/** Where `~name` leads: the home for this user, `/root`, or the home's sibling of that name. */
function homeOf(name: string, context: PlaceContext): string {
  if (name === '' || name === context.user) return context.home
  if (name === 'root' && context.platform !== 'win32') return '/root'
  const separator = context.home.includes('\\') ? '\\' : '/'
  return `${context.home.replace(/[\\/][^\\/]*[\\/]*$/, '')}${separator}${name}`
}

/**
 * A word of the command itself, which no shell reads: only a home written at its start is taken
 * for the home, as a shell would have taken it one step later.
 */
function expandedAtStart(word: string, context: PlaceContext): string {
  const tilde = /^~([A-Za-z0-9._-]*)(?=$|[\\/])/.exec(word)
  if (tilde !== null) return homeOf(tilde[1] ?? '', context) + word.slice(tilde[0].length)
  const variable = /^(?:\$HOME\b|\$\{HOME\}|%USERPROFILE%|%HOME%|\$env:USERPROFILE\b|\$env:HOME\b)/i
  const found = variable.exec(word)
  if (found !== null) return context.home + word.slice(found[0].length)
  return word
}

/** The words of one string as its shell splits them, command by command. */
function readString(text: string, dialect: Dialect, reading: Reading): string[][] {
  const { context } = reading
  const commands: string[][] = []
  let current: string[] = []
  let word = ''
  let started = false
  const fail = (why: string) => {
    reading.unreadable ??= why
  }
  const endWord = () => {
    if (started) current.push(word)
    word = ''
    started = false
  }
  const endCommand = () => {
    endWord()
    if (current.length > 0) commands.push(current)
    current = []
  }
  /** `$…`, read where the shell expands it: the home, a harmless special, or nothing readable. */
  const dollar = (at: number): number => {
    const rest = text.slice(at + 1)
    if (dialect === 'powershell') {
      const home = /^(?:env:USERPROFILE|env:HOME|HOME)\b/i.exec(rest)
      if (home !== null) {
        word += context.home
        started = true
        return at + home[0].length
      }
      const literal = /^(?:true|false|null)\b/i.exec(rest)
      if (literal !== null) {
        word += `$${literal[0]}`
        started = true
        return at + literal[0].length
      }
      if (rest === '' || /^[\s"']/.test(rest)) {
        word += '$'
        started = true
        return at
      }
      fail('a PowerShell variable or expression')
      return at
    }
    const home = /^(?:HOME\b|\{HOME\})/.exec(rest)
    if (home !== null) {
      word += context.home
      started = true
      return at + home[0].length
    }
    if (/^[?$!#]/.test(rest)) {
      word += `$${rest[0] ?? ''}`
      started = true
      return at + 1
    }
    if (rest === '' || /^[\s"']/.test(rest)) {
      word += '$'
      started = true
      return at
    }
    fail(rest.startsWith('(') ? 'a command substitution' : 'a shell variable')
    return at
  }

  for (let at = 0; at < text.length && reading.unreadable === null; at += 1) {
    const character = text[at] ?? ''
    if (/\s/.test(character)) {
      if (character === '\n') endCommand()
      else endWord()
      continue
    }
    // A home written at the start of a word, or after `=` as in `KEY=~/x`.
    if (character === '~' && (!started || /^[A-Za-z_][A-Za-z0-9_]*=$/.test(word))) {
      const tilde = /^~([A-Za-z0-9._-]*)(?=$|[\\/\s;&|<>()])/.exec(text.slice(at))
      if (tilde !== null) {
        word += homeOf(tilde[1] ?? '', context)
        started = true
        at += tilde[0].length - 1
        continue
      }
      if (/^~[+-]/.test(text.slice(at))) {
        fail('a folder named by the shell')
        continue
      }
    }
    if (dialect === 'cmd') {
      if (character === '"') {
        const end = text.indexOf('"', at + 1)
        const quoted = end < 0 ? text.slice(at + 1) : text.slice(at + 1, end)
        word += cmdVariables(quoted, context, fail)
        started = true
        at = end < 0 ? text.length : end
        continue
      }
      if (character === '^') {
        word += text[at + 1] ?? ''
        started = true
        at += 1
        continue
      }
      if (character === '%') {
        const end = text.indexOf('%', at + 1)
        if (end > at) {
          word += cmdVariables(text.slice(at, end + 1), context, fail)
          started = true
          at = end
          continue
        }
      }
      if ('&|()'.includes(character)) {
        endCommand()
        continue
      }
      if ('<>'.includes(character)) {
        if (/^\d+$/.test(word)) word = ''
        started = word !== ''
        endWord()
        if (text[at + 1] === '&') at += 1
        continue
      }
      if (character === '!' && /^![A-Za-z_][A-Za-z0-9_]*!/.test(text.slice(at))) {
        fail('a delayed variable')
        continue
      }
      word += character
      started = true
      continue
    }

    // POSIX shells and PowerShell.
    const escape = dialect === 'powershell' ? '`' : '\\'
    if (character === escape) {
      word += text[at + 1] ?? ''
      started = true
      at += 1
      continue
    }
    if (character === "'") {
      const end = text.indexOf("'", at + 1)
      if (end < 0) {
        fail('an unclosed quote')
        continue
      }
      word += text.slice(at + 1, end)
      started = true
      at = end
      continue
    }
    if (character === '"') {
      started = true
      let closed = false
      for (at += 1; at < text.length && reading.unreadable === null; at += 1) {
        const inner = text[at] ?? ''
        if (inner === '"') {
          closed = true
          break
        }
        if (inner === escape && dialect === 'posix') {
          const next = text[at + 1] ?? ''
          word += '$`"\\\n'.includes(next) ? next : `\\${next}`
          at += 1
        } else if (inner === escape) {
          word += text[at + 1] ?? ''
          at += 1
        } else if (inner === '$') {
          at = dollar(at)
        } else if (inner === '`') {
          fail('a command substitution')
        } else {
          word += inner
        }
      }
      if (!closed) fail('an unclosed quote')
      continue
    }
    if (character === '$') {
      if (dialect === 'posix' && text[at + 1] === "'") {
        fail('an escaped string')
        continue
      }
      at = dollar(at)
      continue
    }
    if (character === '`') {
      fail('a command substitution')
      continue
    }
    if (character === '#' && !started) {
      const end = text.indexOf('\n', at)
      at = end < 0 ? text.length : end - 1
      continue
    }
    if (
      dialect === 'posix' &&
      character === '{' &&
      /^\{[^}\s]*(?:,|\.\.)[^}\s]*\}/.test(text.slice(at))
    ) {
      fail('a brace expansion')
      continue
    }
    if (';&|()'.includes(character) || (dialect === 'powershell' && '{}'.includes(character))) {
      endCommand()
      continue
    }
    if ('<>'.includes(character)) {
      // A redirection: `2>&1` names no file; what follows `>` or `<` is a word like another.
      if (/^\d+$/.test(word)) {
        word = ''
        started = false
      }
      endWord()
      if (text[at + 1] === '>' || text[at + 1] === '<') at += 1
      if (text[at + 1] === '&') {
        at += 1
        const fd = /^[0-9-]+/.exec(text.slice(at + 1))
        if (fd !== null) at += fd[0].length
      }
      continue
    }
    word += character
    started = true
  }
  if (reading.unreadable === null) endCommand()
  return commands
}

/** `%NAME%` inside a `cmd.exe` string: the home, a literal `%`, or nothing readable. */
function cmdVariables(text: string, context: PlaceContext, fail: (why: string) => void): string {
  return text.replace(/%([^%\s]*)%/g, (whole, name: string) => {
    if (name === '') return '%'
    if (/^(?:USERPROFILE|HOME)$/i.test(name)) return context.home
    fail('a cmd.exe variable')
    return whole
  })
}

/** A shell a command may hand a string to: how it is handed, and how it is read. */
interface Shell {
  readonly dialect: Dialect
  readonly code: (rest: readonly string[]) => Code | 'script' | null | undefined
  /** Why a string it was told to read is not there to read. */
  readonly missing: string
}

/** The shell a program is, by its name, and null when it is none. */
function shellOf(name: string): Shell | null {
  if (POSIX_SHELLS.has(name)) {
    return { dialect: 'posix', code: posixCode, missing: 'a shell string that is missing' }
  }
  if (POWERSHELLS.has(name)) {
    return {
      dialect: 'powershell',
      code: powershellCode,
      missing: 'a PowerShell command that does not read',
    }
  }
  if (name === 'cmd') {
    return { dialect: 'cmd', code: cmdCode, missing: 'a shell string that is missing' }
  }
  return null
}

/** A string one word of a command hands to a shell, or why it cannot be read. */
type Carried =
  | {
      readonly text: string
      readonly dialect: Dialect
      /** The words the string was made of, which are not paths of this command. */
      readonly from: number
      readonly to: number
    }
  | { readonly unreadable: string }

/** The first string this command hands on, and null when it hands none. */
function carriedBy(
  words: readonly string[],
  first: number,
  dialect: Dialect | null,
): Carried | null {
  for (const [at, word] of words.entries()) {
    if (at < first) continue
    const name = programName(word)
    const leads = at === first
    const rest = words.slice(at + 1)
    const from = at + 1
    const shell = shellOf(name)
    if (shell !== null) {
      const carried = shell.code(rest)
      if (carried === 'script') continue
      if (carried === null) {
        if (leads) return { unreadable: 'a shell reading its standard input' }
        continue
      }
      if (carried === undefined) {
        return { unreadable: shell.missing }
      }
      return {
        text: carried.text,
        dialect: shell.dialect,
        from: from + carried.at,
        to: words.length,
      }
    }
    if (leads && name === 'eval' && dialect === 'posix') {
      return { text: rest.join(' '), dialect: 'posix', from, to: words.length }
    }
    if (leads && (name === 'invoke-expression' || name === 'iex') && dialect === 'powershell') {
      return { text: rest.join(' '), dialect: 'powershell', from, to: words.length }
    }
    if (rest.some((flag) => inlineCode(name, flag))) return { unreadable: `code handed to ${name}` }
  }
  return null
}

/** Where the paths of one command's words are, and the strings it hands on, read in turn. */
function readCommand(
  words: readonly string[],
  dialect: Dialect | null,
  reading: Reading,
  depth: number,
): void {
  const { context } = reading
  if (depth > 6) {
    reading.unreadable ??= 'shell strings nested too deep'
    return
  }
  reading.commands.push(words)
  let first = 0
  // `KEY=value command`: the value is a word like another, and the command comes after it.
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[first] ?? '')) first += 1
  const carried = carriedBy(words, first, dialect)
  if (carried !== null && 'unreadable' in carried) {
    reading.unreadable ??= carried.unreadable
    return
  }
  const place = (word: string) => {
    const spelled = dialect === null ? expandedAtStart(word, context) : word
    if (spelled !== '') reading.paths.push(spelled)
  }
  for (const [at, word] of words.entries()) {
    if (at === first || (carried !== null && at >= carried.from && at < carried.to)) continue
    const option =
      word.startsWith('-') ||
      (context.platform === 'win32' && /^\/[A-Za-z0-9?]+(?::\S*)?$/.test(word))
    if (option || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      const equals = word.indexOf('=')
      if (equals >= 0) place(word.slice(equals + 1))
      continue
    }
    place(word)
  }
  const program = programName(words[first] ?? '')
  if (CHANGES_FOLDER.has(program) && words.length === first + 1) reading.paths.push(context.home)
  if (carried !== null) read(carried.text, carried.dialect, reading, depth + 1)
}

/** A shell's string, and where among the words after the shell it starts. */
interface Code {
  readonly text: string
  readonly at: number
}

/** The string `cmd.exe` is handed after `/c`, `/k` or `/r`: the rest of its line. */
function cmdCode(rest: readonly string[]): Code | null | undefined {
  const at = rest.findIndex((one) => /^\/[ckr]$/i.test(one))
  if (at < 0) return null
  return at + 1 < rest.length ? { text: rest.slice(at + 1).join(' '), at: at + 1 } : undefined
}

/**
 * The string a POSIX shell is handed with `-c`, `'script'` when it runs a file, null when it
 * reads its standard input, and undefined when `-c` is there without its string.
 */
function posixCode(rest: readonly string[]): Code | 'script' | null | undefined {
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? ''
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(word)) {
      const text = rest[at + 1]
      return text === undefined ? undefined : { text, at: at + 1 }
    }
    if (word === '-o' || word === '+o') {
      at += 1
      continue
    }
    if (word.startsWith('-') || word.startsWith('+')) continue
    return 'script'
  }
  return null
}

/** The command PowerShell is handed, as `posixCode` says it for a POSIX shell. */
function powershellCode(rest: readonly string[]): Code | 'script' | null | undefined {
  const from = (at: number) =>
    at < rest.length ? { text: rest.slice(at).join(' '), at } : undefined
  for (let at = 0; at < rest.length; at += 1) {
    const word = rest[at] ?? ''
    if (!/^[-/]/.test(word)) return from(at)
    const flag = word.slice(1).toLowerCase().split(':')[0] ?? ''
    if (
      flag === 'c' ||
      flag === 'cwa' ||
      flag === 'commandwithargs' ||
      (flag.length >= 3 && 'command'.startsWith(flag))
    ) {
      return from(at + 1)
    }
    if (flag === 'e' || flag === 'ec' || (flag.length >= 3 && 'encodedcommand'.startsWith(flag))) {
      return undefined
    }
    if (flag === 'f' || flag === 'file') return 'script'
    if (POWERSHELL_VALUES.has(flag)) at += 1
  }
  return null
}

/** One string handed to a shell, read command by command. */
function read(text: string, dialect: Dialect, reading: Reading, depth: number): void {
  if (text.trim() === '') {
    reading.unreadable ??= 'a shell string that is missing'
    return
  }
  for (const command of readString(text, dialect, reading)) {
    if (reading.unreadable !== null) return
    readCommand(command, dialect, reading, depth)
  }
}

/**
 * The paths a command names: its words as the runner splits them, the program first, and the
 * words of every string it hands to a shell (`sh -c`, `bash -lc`, `cmd /c`, `powershell -Command`)
 * as that shell would read them. The home is expanded in every spelling; what a shell would
 * compute and Hemera cannot — another variable, a substitution, inline code for an interpreter —
 * makes the words unreadable, and the caller takes the call for outside.
 */
export function placesNamed(words: readonly string[], context: PlaceContext): NamedPlaces {
  const reading: Reading = { context, paths: [], commands: [], unreadable: null }
  readCommand(words, null, reading, 0)
  return { paths: reading.paths, commands: reading.commands, unreadable: reading.unreadable }
}
