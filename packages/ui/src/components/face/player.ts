import { face, faceArrive, faceArriveSpan, faceCarry, faceCoast } from '../../motion.ts'
import {
  CHOREOGRAPHIES,
  type ChangeName,
  type Windows,
  blinkOf,
  changeBetween,
  changePace,
} from './changes.ts'
import { between, dice, strand } from './life.ts'
import {
  AT,
  type Beat,
  CHANNELS,
  type Channel,
  type Pose,
  type Pull,
  poseOf,
  strokeAt,
} from './pose.ts'
import { EXPRESSIONS, type Expression, type FaceState } from './states.ts'
import { type Stroke, meet, scaled, toward } from './strokes.ts'

/**
 * The face's player: what the face is at any instant, told from the state it started in, the
 * changes it was given and the seed it was handed.
 *
 * Nothing here keeps a clock. A frame is asked for at a time, and what comes back is the same for
 * the same seed, the same changes and the same time — which is what makes a story deterministic,
 * and every transition testable one frame at a time. It plays by the motion preset's `face` kind.
 *
 * Inside a state the face holds still. Only loading's orbit goes on turning, and a state that
 * waits for the reader blinks slowly now and then; a change of state is one movement, and then
 * the face is still again.
 */

/**
 * How much of the face a size can hold. Small, the face simplifies rather than blurs: features
 * drawn larger in their box and in heavier strokes, movements that travel further so they still
 * read. The mouth is drawn at every size unless the caller leaves it out.
 */
export interface FaceDetail {
  readonly mouth: boolean
  /**
   * How much larger the features are drawn in their box. Small, past it: the box is what the
   * layout sees, so a face in a line of text leaves the line as tall as it was, and reads all
   * the same.
   */
  readonly scale: number
  readonly weight: number
  readonly gain: number
}

export const DETAILS = {
  icon: { mouth: true, scale: 1.6, weight: 1.05, gain: 1.2 },
  small: { mouth: true, scale: 1.3, weight: 1.05, gain: 1.15 },
  full: { mouth: true, scale: 1, weight: 1, gain: 1 },
} as const satisfies Record<string, FaceDetail>

export type DetailName = keyof typeof DETAILS

/** One drawing of the face, and how much of it shows. */
export interface FaceLayer {
  readonly pose: Pose
  readonly opacity: number
}

/** What the face is at one instant, for whoever draws it or tests it. */
export interface FaceFrame {
  /**
   * What to draw, bottom first: one face while it moves, or the still faces a cross-fade is
   * passing between when the reader asked for less movement.
   */
  readonly layers: readonly FaceLayer[]
  readonly state: FaceState
  readonly change: { readonly name: ChangeName; readonly progress: number } | null
  /**
   * Nothing will move before the next change: a state that neither waits nor loads, once the
   * change into it is over, or any state for a reader asking for less movement, settled.
   */
  readonly still: boolean
}

export interface FaceOptions {
  readonly state: FaceState
  /** When the face starts, in seconds, on whatever clock its frames will be asked on. */
  readonly at: number
  readonly seed: number
  /** Still expressions and a soft cross-fade between them, and nothing else. */
  readonly reduced: boolean
}

export interface FacePlayer {
  /** Goes into `state` at `at`, from wherever the face is then. The same state is no change. */
  readonly change: (state: FaceState, at: number) => void
  readonly frame: (at: number) => FaceFrame
}

/** A moment of a story, and the moment it ends. */
interface Timed {
  readonly start: number
  readonly end: number
}

interface Found<T> {
  readonly current: T | null
  readonly previous: T | null
}

/** How many events of a strand are kept; asked for an older moment, the strand is told again. */
const KEPT = 16

/**
 * Events drawn one after another from a seed. Only the last few are kept, and a moment older
 * than those is answered by telling the strand again from its start, which gives the very same
 * events: that is what lets a face live for hours without keeping hours of blinks.
 */
function strandOf<T extends Timed>(
  seed: number,
  next: (previous: T | null, random: () => number) => T,
): (at: number) => Found<T> {
  let random = dice(seed)
  let kept: T[] = []
  let dropped = false
  return (at) => {
    if (dropped && kept.length > 1 && at < kept[1]!.start) {
      random = dice(seed)
      kept = []
      dropped = false
    }
    while (kept.length === 0 || kept.at(-1)!.start <= at) {
      kept.push(next(kept.at(-1) ?? null, random))
      if (kept.length > KEPT) {
        kept.shift()
        dropped = true
      }
    }
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      if (kept[index]!.start <= at) {
        return { current: kept[index]!, previous: kept[index - 1] ?? null }
      }
    }
    return { current: null, previous: null }
  }
}

/** A stretch of the loading at one width, eased into from the width before it. */
interface Drift extends Timed {
  readonly from: number
  readonly to: number
}

/** A stretch of the loading at one speed, eased into, and how far round it had gone by then. */
interface Pace extends Timed {
  readonly from: number
  readonly to: number
  readonly spun: number
}

/**
 * The turns a stretch of the loading has covered from its start to `at`: its old pace, plus what
 * the ease into its new pace added on top — the area under the eased speed, not a straight line.
 */
function pacedOn(pace: Pace, at: number): number {
  const τ = Math.max(0, at - pace.start)
  const { paceEase } = face.loading
  const eased = paceEase * faceArriveSpan(τ / paceEase)
  return (pace.from * τ + (pace.to - pace.from) * eased) / face.spin
}

/** A blink closing over `down`, staying shut for `hold` and opening over `up`, `τ` seconds in. */
function pulse(
  τ: number,
  hold: number,
  { down, up }: { down: number; up: number } = face.blink,
): number {
  if (τ <= 0) return 0
  if (τ < down) return faceArrive(τ / down)
  if (τ < down + hold) return 1
  if (τ < down + hold + up) return 1 - faceArrive((τ - down - hold) / up)
  return 0
}

/** A blink a change comes with: where it starts and how long it stays shut, in seconds. */
interface ChangeBlink {
  readonly start: number
  readonly hold: number
}

/** The blink a change is carried across, and the windows it leaves the change's parts. */
interface Carried {
  readonly blink: ChangeBlink | null
  readonly windows: Windows
}

/** A change under way: where it took the face from, and how it goes. */
interface Run {
  readonly name: ChangeName
  readonly length: number
  readonly windows: Windows
  readonly side: number
  readonly chance: number
  readonly from: FaceState
  /** Where every number of the face was when the change came, and how fast it was going. */
  readonly start: Pose
  readonly speed: Pose
  /** Where the life of the new state had the face at that same moment. */
  readonly landing: Pose
  readonly blink: ChangeBlink | null
  /** Where round the loading orbit the change starts and ends, and how fast, for boot and gather. */
  readonly turn: Turn | null
}

/**
 * The orbit's journey through a change, in turns: where it starts and ends, and how fast it goes
 * at either end, in turns per length of the change. A curve that leaves at the speed it had and
 * arrives at the speed it keeps is what lets the dots go on turning through the change.
 */
interface Turn {
  readonly from: number
  readonly to: number
  readonly leaving: number
  readonly arriving: number
}

/** Where a turn is, `q` of the way through the change. */
function turned(turn: Turn, q: number): number {
  return (
    turn.from * (1 - faceArrive(q)) +
    turn.to * faceArrive(q) +
    turn.leaving * faceCarry(q) -
    turn.arriving * faceCarry(1 - q)
  )
}

interface Segment {
  readonly state: FaceState
  readonly expression: Expression
  readonly t0: number
  /** The slow blinks of a state that waits for the reader. */
  readonly blinks: (at: number) => Found<Timed>
  /** The loading's two clocks: how wide its dots sit, and how fast they go. */
  readonly reaches: (at: number) => Found<Drift>
  readonly paces: (at: number) => Found<Pace>
  readonly run: Run | null
  /** Under reduced motion: what was showing when this state began, fading out under it. */
  readonly faded: readonly FaceLayer[]
  /** What the change into this state is called, for whoever tests the face. */
  readonly name: ChangeName | null
}

/** How far back a speed is read from, in seconds: a quarter of a frame at sixty. */
const STEP = 1 / 240

/** How many states are kept: enough to read the speed of the last one when the next comes. */
const KEPT_SEGMENTS = 4

/** How many faces a cross-fade shows at most; the faintest goes first. */
const LAYERS = 3

const CHANNEL_NAMES: readonly Channel[] = ['shape', 'mouth', 'lid', 'head', 'gaze', 'orbit', 'tone']

/** Writes a stroke into a pose at `start`. */
function write(pose: number[], start: number, stroke: Stroke): void {
  for (let index = 0; index < 7; index += 1) pose[start + index] = stroke[index]!
}

/** Plays a beat on a pose: the head moves by it, lids close to it, features pull towards it. */
function play(pose: number[], said: Beat): void {
  pose[AT.yaw] = pose[AT.yaw]! + said.yaw
  pose[AT.pitch] = pose[AT.pitch]! + said.pitch
  pose[AT.gazeX] = pose[AT.gazeX]! + said.gazeX
  pose[AT.gazeY] = pose[AT.gazeY]! + said.gazeY
  pose[AT.lidLeft] = Math.max(pose[AT.lidLeft]!, said.lid)
  pose[AT.lidRight] = Math.max(pose[AT.lidRight]!, said.lid)
  const pulled = (start: number, pull: Pull | null): void => {
    if (pull !== null) write(pose, start, toward(strokeAt(pose, start), pull.to, pull.k))
  }
  pulled(AT.left, said.left)
  pulled(AT.right, said.right)
  pulled(AT.mouth, said.mouth)
  if (said.mouthScale !== 1)
    write(pose, AT.mouth, scaled(strokeAt(pose, AT.mouth), said.mouthScale))
}

/** A state's expression held still: what reduced motion shows, and all it shows. */
function stillOf(expression: Expression): number[] {
  return poseOf({
    left: expression.eyes[0],
    right: expression.eyes[1],
    mouth: expression.mouth,
    lidLeft: expression.lid,
    lidRight: expression.lid,
    head: expression.look,
    orbit: expression === EXPRESSIONS.loading ? 1 : 0,
    spin: 0,
    reach: 0,
    tone: expression.tone,
  })
}

export function createFace(options: FaceOptions): FacePlayer {
  const { reduced } = options
  const segments: Segment[] = []

  /** A state begun at `t0`, its strands drawn from its own seed. */
  const begin = (
    state: FaceState,
    t0: number,
    seed: number,
    run: Run | null,
    faded: readonly FaceLayer[],
    name: ChangeName | null,
    settling = 0,
  ): Segment => {
    const expression = EXPRESSIONS[state]
    return {
      state,
      expression,
      t0,
      run,
      faded,
      name,
      // The first slow blink waits for the change into the state to be over, and its gap besides.
      blinks: strandOf<Timed>(strand(seed, 1), (previous, random) => {
        const start = (previous?.start ?? t0 + settling) + between(random(), ...face.call.every)
        return { start, end: start + face.call.down + face.call.up }
      }),
      // The loading's first stretch is its plain width and beat, and lasts past the change into
      // it, so that a change landing on the loading lands where the loading's own clock has it.
      reaches: strandOf<Drift>(strand(seed, 5), (previous, random) => {
        const start = previous?.end ?? t0
        const hold =
          between(random(), ...face.loading.reachHold) + (previous === null ? settling : 0)
        const to = previous === null ? 0 : face.loading.reaches[Math.floor(random() * 3)]!
        return { start, end: start + hold, from: previous?.to ?? 0, to }
      }),
      paces: strandOf<Pace>(strand(seed, 6), (previous, random) => {
        const start = previous?.end ?? t0
        const hold =
          between(random(), ...face.loading.paceHold) + (previous === null ? settling : 0)
        const to = previous === null ? 1 : face.loading.paces[Math.floor(random() * 2)]!
        const spun =
          previous === null ? t0 / face.spin : previous.spun + pacedOn(previous, previous.end)
        return { start, end: start + hold, from: previous?.to ?? 1, to, spun }
      }),
    }
  }

  /** How wide the loading's dots sit at `at`, eased from one width to the next. */
  const reachAt = (segment: Segment, at: number): number => {
    const { current } = segment.reaches(at)
    if (current === null) return 0
    return (
      current.from +
      (current.to - current.from) * faceArrive((at - current.start) / face.loading.reachEase)
    )
  }

  /** How far round the loading has gone at `at`, its speed eased from one pace to the next. */
  const spinAt = (segment: Segment, at: number): number => {
    const { current } = segment.paces(at)
    if (current === null) return at / face.spin
    return current.spun + pacedOn(current, at)
  }

  /** How shut the lids are from the slow blink of a state that waits, at `at`. */
  const blinking = (segment: Segment, at: number): number => {
    if (!segment.expression.waits) return 0
    const { current } = segment.blinks(at)
    if (current === null) return 0
    return pulse(at - current.start, 0, face.call)
  }

  /** The face inside a state at `at`: its expression, held, but for a slow blink or the orbit. */
  const lifeAt = (segment: Segment, at: number): number[] => {
    const { expression } = segment
    const lid = Math.max(expression.lid, blinking(segment, at))
    return poseOf({
      left: expression.eyes[0],
      right: expression.eyes[1],
      mouth: expression.mouth,
      lidLeft: lid,
      lidRight: lid,
      head: expression.look,
      // Loading rides the orbit, a turn every beat of the loading indicator, on the clock
      // itself, so that two loading faces go round together as two indicators do.
      orbit: segment.state === 'loading' ? 1 : 0,
      spin: segment.state === 'loading' ? spinAt(segment, at) : 0,
      reach: segment.state === 'loading' ? reachAt(segment, at) : 0,
      tone: expression.tone,
    })
  }

  /**
   * The face at `at` inside one state: its life, and — while the change into it lasts — the
   * journey from wherever the change found the face, each part on its own window, with what the
   * change says on the way played on top.
   */
  const poseAt = (segment: Segment, at: number): number[] => {
    const life = lifeAt(segment, at)
    const { run } = segment
    if (run === null) return life
    const q = (at - segment.t0) / run.length
    if (q >= 1) return life
    if (run.turn !== null) return orbiting(run, run.turn, q, life)
    const pose = life.slice()
    const carried = face.carry * run.length * faceCarry(q)
    for (const channel of CHANNEL_NAMES) {
      const [from, to] = run.windows[channel]
      const k = to > from ? faceArrive((q - from) / (to - from)) : q >= from ? 1 : 0
      // Only the head and the eyes' direction keep their speed: a shape or a colour taken over
      // half-way only travels on, or a startled eye snapping shut would fling its next shape away.
      const speed = channel === 'head' || channel === 'gaze' ? carried : 0
      const [first, last] = CHANNELS[channel]
      for (let index = Number(first); index < last; index += 1) {
        // The orbit's turns are not a place to ease back to: they coast to a stop instead.
        if (index === AT.spin) {
          pose[index] = run.start[index]! + run.speed[index]! * run.length * faceCoast(q)
          continue
        }
        const offset = (run.start[index]! - run.landing[index]!) * (1 - k)
        pose[index] = life[index]! + offset + run.speed[index]! * speed
      }
    }
    play(
      pose,
      CHOREOGRAPHIES[run.name].beat({
        q,
        side: run.side,
        chance: run.chance,
        from: run.from,
        to: segment.state,
      }),
    )
    if (run.blink !== null) {
      const shut = pulse(at - segment.t0 - run.blink.start, run.blink.hold)
      pose[AT.lidLeft] = Math.max(pose[AT.lidLeft]!, shut)
      pose[AT.lidRight] = Math.max(pose[AT.lidRight]!, shut)
    }
    pose[AT.lidLeft] = Math.min(1, Math.max(0, pose[AT.lidLeft]!))
    pose[AT.lidRight] = Math.min(1, Math.max(0, pose[AT.lidRight]!))
    return pose
  }

  /**
   * A face coming out of loading, or going into it: the features ride the orbit on its own
   * curve — on turning at the speed they had, or wound up to the speed the loading keeps — while
   * they leave it for their places or come out onto it, and change shape on the way.
   */
  const orbiting = (run: Run, turn: Turn, q: number, life: Pose): number[] => {
    const booting = run.name === 'boot'
    const pose = life.slice()
    // All of it at once: the dots slow down, spiral in and round out into their features in one
    // movement, and a face balls up while it is already being taken round.
    const shape = booting ? faceArrive((q - 0.1) / 0.85) : faceArrive(q / 0.7)
    for (const start of [AT.left, AT.right, AT.mouth]) {
      write(pose, start, toward(strokeAt(run.start, start), strokeAt(life, start), shape))
    }
    const settled = faceArrive(q)
    for (let index = AT.lidLeft; index < AT.orbit; index += 1) {
      pose[index] = run.start[index]! + (life[index]! - run.start[index]!) * settled
    }
    const out = run.start[AT.orbit]!
    pose[AT.orbit] = booting ? out * (1 - faceArrive(q)) : out + (1 - out) * faceArrive(q)
    pose[AT.spin] = turned(turn, q)
    pose[AT.reach] = run.start[AT.reach]! + (life[AT.reach]! - run.start[AT.reach]!) * settled
    const colour = faceArrive(q)
    for (let index = AT.tones; index < life.length; index += 1) {
      pose[index] = run.start[index]! + (life[index]! - run.start[index]!) * colour
    }
    return pose
  }

  /**
   * Where the orbit goes through a change out of loading or into it.
   *
   * Out of it, the dots slow to a stop exactly where each one's feature is, going on the way they
   * were going. The three dots are alike, so which one becomes which feature is chosen here, a
   * third of a turn at a time: the one that will end at the bottom becomes the mouth. Into it,
   * the features are wound up from rest to the speed the loading turns at, arriving where the
   * loading's own clock has them.
   */
  const turnFor = (
    name: ChangeName,
    start: Pose,
    speed: Pose,
    at: number,
    length: number,
  ): Turn | null => {
    const full = length / face.spin
    // How fast the orbit was already turning, in turns per length of this change.
    const going = (speed[AT.spin] ?? 0) * length
    if (name === 'gather') {
      const due = (at + length) / face.spin
      // A face at rest starts with each feature's place on the orbit where the feature is, so each
      // leaves for the part of the orbit beside it and none crosses the middle; one already on its
      // way round starts from where it is. Either ends where the loading's clock has the dots, to a
      // third of a turn — three alike dots, which one is which no longer shows.
      const resting = start[AT.orbit]! < 0.01
      const from = resting ? Math.round(due - full / 2) : start[AT.spin]!
      const least = resting ? full / 3 + 0.02 : 0.1
      let to = due + Math.ceil((from + least - due) * 3) / 3
      for (let more = 1; more <= 3; more += 1) {
        const candidate = to + more / 3
        if (Math.abs(candidate - from - full / 2) < Math.abs(to - from - full / 2)) to = candidate
      }
      return { from, to, leaving: resting ? 0 : going, arriving: full }
    }
    if (name !== 'boot') return null
    const from = start[AT.spin]!
    // A third of a turn at a time only while the three dots are three alike dots on the orbit.
    const alike = start[AT.orbit]! > 0.99
    const step = alike ? 1 / 3 : 1
    // Slowing to a stop covers half the turns full speed would; never less than a third of full
    // speed's, or the curve would turn back on itself before it stops.
    const least = full / 3 + 0.02
    const first = Math.ceil((from + least) / step) * step - from
    let travel = first
    for (let more = 1; more <= 3; more += 1) {
      const candidate = first + more * step
      if (Math.abs(candidate - full / 2) < Math.abs(travel - full / 2)) travel = candidate
    }
    const end = from + travel
    // The whole turns the relabelled dots still owe, so each ends on its own feature's place.
    const owed = alike ? ((-Math.round(end * 3) % 3) + 3) % 3 : 0
    return { from: from + owed / 3, to: end + owed / 3, leaving: going, arriving: 0 }
  }

  /** The state the face was in at `at`: the last one begun by then. */
  const segmentAt = (at: number): Segment => {
    for (let index = segments.length - 1; index > 0; index -= 1) {
      if (segments[index]!.t0 <= at) return segments[index]!
    }
    return segments[0]!
  }

  const frame = (at: number): FaceFrame => {
    const segment = segmentAt(at)
    const { run } = segment
    if (reduced) {
      const k = segment.faded.length === 0 ? 1 : faceArrive((at - segment.t0) / face.fade)
      const layers = [
        ...segment.faded.map((layer) => ({ pose: layer.pose, opacity: layer.opacity * (1 - k) })),
        { pose: stillOf(segment.expression), opacity: k },
      ]
        .filter((layer) => layer.opacity > 0.004)
        .slice(-LAYERS)
      return {
        layers,
        state: segment.state,
        change: k < 1 && segment.name !== null ? { name: segment.name, progress: k } : null,
        still: k >= 1,
      }
    }
    const progress = run === null ? 1 : (at - segment.t0) / run.length
    const lives = segment.expression.waits || segment.state === 'loading'
    return {
      layers: [{ pose: poseAt(segment, at), opacity: 1 }],
      state: segment.state,
      change: run !== null && progress < 1 ? { name: run.name, progress } : null,
      still: progress >= 1 && !lives,
    }
  }

  /**
   * The blink a change is carried across, if it needs one: an eye that goes from one family of
   * shapes to another — a cursor laid down, a chevron balled up into a dot — would turn on its
   * side or into a heart on the way, so it changes behind a closed lid instead, the way an animator
   * cuts on a blink. A change with a blink of its own blinks where it says.
   */
  const blinkFor = (
    name: ChangeName,
    length: number,
    start: Pose,
    to: Expression,
    chance: number,
  ): Carried => {
    const { windows } = CHOREOGRAPHIES[name]
    const { down, up, hold } = face.blink
    // In and out of loading the shapes change on the orbit, where nothing needs to be hidden.
    if (name === 'boot' || name === 'gather') return { blink: null, windows }
    const crossing =
      !meet(strokeAt(start, AT.left), to.eyes[0]) || !meet(strokeAt(start, AT.right), to.eyes[1])
    if (crossing) {
      const at = Math.max(0, Math.min(windows.shape[0] * length - down, length - down - hold - up))
      // The shape changes while the lid is mostly down, not only in the instant it is shut: a
      // closed eye keeps its own width, and a width changed in sixty milliseconds is a jump.
      const shut: readonly [number, number] = [
        (at + down * 0.5) / length,
        (at + down + hold + up * 0.5) / length,
      ]
      return { blink: { start: at, hold }, windows: { ...windows, shape: shut } }
    }
    const own = blinkOf(name, chance)
    if (own === null) return { blink: null, windows }
    return { blink: { start: Math.min(own * length, length - down - up), hold: 0 }, windows }
  }

  const change = (state: FaceState, at: number): void => {
    const last = segments.at(-1)!
    if (state === last.state) return
    const seed = strand(options.seed, segments.length + 1)
    const name = changeBetween(last.state, state)
    if (reduced) {
      const showing = frame(at).layers
      segments.push(begin(state, at, seed, null, showing, name))
    } else {
      const start = poseAt(segmentAt(at), at)
      // Before the face began there is nothing to have been moving from.
      const before = at - STEP < segments[0]!.t0 ? start : poseAt(segmentAt(at - STEP), at - STEP)
      const speed = start.map((value, index) => (value - before[index]!) / STEP)
      const random = dice(strand(seed, 4))
      const side = random() < 0.5 ? -1 : 1
      const chance = random()
      const { down, up, hold } = face.blink
      // A change shorter than a blink cannot be carried across one: it is given the room to.
      const length = Math.max(face.change[name] * changePace(name, state), down + hold + up + STEP)
      const { blink, windows } = blinkFor(name, length, start, EXPRESSIONS[state], chance)
      const draft = begin(state, at, seed, null, [], name, length)
      const run: Run = {
        name,
        length,
        windows,
        side,
        chance,
        from: last.state,
        start,
        speed,
        landing: lifeAt(draft, at),
        blink,
        turn: turnFor(name, start, speed, at, length),
      }
      segments.push({ ...draft, run })
    }
    if (segments.length > KEPT_SEGMENTS) segments.shift()
  }

  segments.push(begin(options.state, options.at, strand(options.seed, 0), null, [], null))

  return { change, frame }
}
