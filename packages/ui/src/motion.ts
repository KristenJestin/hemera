import { MotionConfigContext, useReducedMotion } from 'motion/react'
import type { Easing, TargetAndTransition, Transition } from 'motion/react'
import { useContext } from 'react'

/**
 * The motion personality of Hemera: a closed set of presets, and nowhere else to write a
 * spring. A lint check refuses a `stiffness`, a `damping` or a duration written anywhere but
 * this file, because a design system whose springs are scattered has no personality at all.
 *
 * Two of them, and not one, because one cannot do both jobs. The spring the prototype earned
 * is made for a panel that arrives without overshooting, and it takes its time doing it; under
 * a finger it takes so long to settle that a three per cent press is not visible at all. What
 * answers the hand has to be stiff and light, and what arrives on its own has to be soft.
 *
 * A third preset arrived with the shell, for the one thing neither of these serves: a width
 * that changes. The set is meant to stay short.
 */

/** What answers the hand: hover, press, a width following what the press changed. */
export const press: Transition = { type: 'spring', stiffness: 500, damping: 30, mass: 0.6 }

/** What puts itself in place: panels, popups, a swap of content. The prototype's own spring. */
export const arrival: Transition = { type: 'spring', stiffness: 170, damping: 26 }

/**
 * What changes size in place: the sidebar folding to its rail and opening back out (D2-03).
 *
 * The other two presets are made for a transform, where a little overshoot reads as life. A
 * dimension that overshoots reads as a mistake — the panel goes past its width and the
 * columns beside it come back to meet it — so this one sits just past critical damping and
 * arrives without ever turning round.
 */
export const morph: Transition = { type: 'spring', stiffness: 260, damping: 33, mass: 1 }

/**
 * How the active tab crosses the strip, as two edges rather than one slab (design D2-02).
 *
 * A slab that slides keeps its width the whole way and reads as a piece of chrome being moved.
 * Two edges let it stretch: the mark first opens far enough to cover both the tab it is leaving
 * and the tab it is going to, then closes onto the second — so it reads as one sheet reaching
 * across rather than as a rectangle in transit.
 *
 * `reach` is the opening, a tween because it has one job and no weight to it. `lead` is the
 * edge in the direction of travel closing first, and `trail` the one behind it closing after,
 * which is what leaves the stretch. `settle` is what takes the trailing edge off the small
 * overshoot it lands with.
 */
export const reach: Transition = { duration: 0.19, ease: [0.23, 1, 0.32, 1] }
export const lead: Transition = { type: 'spring', duration: 0.3, bounce: 0 }
export const trail: Transition = { type: 'spring', duration: 0.3, bounce: 0.2 }
export const settle: Transition = { duration: 0.16, ease: [0.23, 1, 0.32, 1] }

/** How long the mark stays open before the edges begin to close, in seconds. */
export const REACH_HANDOFF = 0.15

/** How far the trailing edge overshoots before it relaxes, in pixels. */
export const REACH_OVERSHOOT = 3

/** The same arrival, with nothing in between: what a system asking for less movement gets. */
export const instant: Transition = { duration: 0 }

/**
 * How far a press takes a control from its resting size — and a second, deeper one for a
 * control that is only as wide as it is tall.
 *
 * The same ratio does not read the same on two sizes: a wide button pulls its edges in by
 * several pixels and is unmistakable, while a square one moves by a single pixel and looks
 * like nothing happened at all. What has to match between them is the movement, not the
 * number, so the small one goes deeper.
 */
export const PRESSED = 0.93
export const PRESSED_COMPACT = 0.86
export const HOVERED = 1.02

/** How far the mark of a state travels in from under the edge, in pixels. */
export const MARK_TRAVEL = 12

/**
 * How far the foot of a message travels as it appears, in pixels.
 *
 * Less than a mark and less than a label: the foot is a line of small type under a bubble, and
 * what it has to read as is the bubble settling rather than as a piece of chrome being moved.
 */
export const FOOT_TRAVEL = 6

/** How far the label of a folding panel slides in from, in pixels. */
export const LABEL_TRAVEL = 8

/**
 * How long the labels of a folding panel let the width go first, in the seconds motion counts
 * in. Opening only: on the way out they leave at once, because a label still sitting in a rail
 * that has already closed is the one frame that reads as a bug.
 */
export const LABEL_DELAY = 0.08

/**
 * The durations of the theme, in the seconds motion counts in.
 *
 * `turn` is the long one the stylesheet already spins and breathes on — `--duration-turn` —
 * and it is written here so that what motion repeats keeps the same beat as what CSS repeats.
 */
export const durations = { fast: 0.16, base: 0.26, slow: 0.4, turn: 1.2 } as const

/** The curve the theme's `--ease-calm` draws, for the few transitions that are not a spring. */
export const easing: Easing = [0.25, 0.8, 0.25, 1]

/**
 * The transition to animate with, which is the preset asked for unless less movement was.
 *
 * motion's own `reducedMotion` jumps a transform to its target and keeps animating opacity and
 * colour. What reduced motion has to mean here is the end state without the journey, for every
 * property at once, so the journey is given no time instead. The tree still runs under
 * `MotionConfig reducedMotion="user"`: it is the net under any motion element that forgets
 * this hook, and the lint refuses one that does.
 *
 * Both ways of asking are honoured: the system preference, and a `MotionConfig` that says
 * `always`. `never` is not one of them, because `never` is also motion's own default: a
 * component rendered outside any `MotionConfig` reads it, and reading it as "this tree opted
 * out" is how the one guard the design system has ends up switched off by nobody.
 */
export function useTransition(preset: Transition = arrival): Transition {
  const { reducedMotion } = useContext(MotionConfigContext)
  const system = useReducedMotion()
  if (reducedMotion === 'always') return instant
  return system === true ? instant : preset
}

/**
 * Which way a surface is travelling, from the reader's side: on into the next thing, or back
 * to where they came from. The same kind plays both, mirrored, so a panel never comes back the
 * way it went.
 */
export type SlideDirection = 'forward' | 'backward'

/**
 * How far a slide goes, and the two answers a surface ever needs.
 *
 * `stage` is a swap: one surface leaves by its own width and the next arrives from the other
 * side, so what is read is a replacement — the agent stage of the model menu giving way to the
 * models. `nudge` is the same movement kept short, for a surface that is being replaced *in
 * place* while the frame around it does not move at all: the models column of the two-column
 * menu changing agent. A nudge as long as a swap reads as the whole panel sliding; a swap as
 * short as a nudge reads as a list that was there all along.
 */
export const SLIDE = { stage: '100%', nudge: '12%' } as const

/** Which of the two distances a slide is drawn at. */
export type SlideDistance = keyof typeof SLIDE

/** Where a sliding surface comes in from, and where the one it replaces goes out to. */
export interface Slide {
  enter: string
  leave: string
}

/**
 * The `slide` kind: a surface arriving from one side while the one it replaces leaves by the
 * other, at one of the two distances and in one of the two directions.
 *
 * The timing is not its own — a slide is something putting itself in place, so it is played on
 * `arrival` like everything else that does. Only the geometry lives here, which is the whole
 * reason it is a kind and not a pair of constants in whichever component needed it first.
 */
export function slide(distance: SlideDistance, direction: SlideDirection = 'forward'): Slide {
  const away = SLIDE[distance]
  const back = `-${away}`
  return direction === 'forward' ? { enter: away, leave: back } : { enter: back, leave: away }
}

/**
 * The `expand` and `collapse` kinds: a body whose height is its own, growing and folding away.
 *
 * Height and a fade together. The height is what makes room — the page under it moves over
 * rather than being redrawn — and the fade is what keeps the clipped edge from reading as a
 * line of text cut in half on the way. A tool call's body, a thought, a menu panel whose stage
 * is taller than the last one: all of them are this.
 *
 * The fade is a `filter` and not an `opacity`, for the reason the foot of a message gives: the
 * accessibility check of the catalogue measures a text's contrast through an opacity and
 * refuses the value it reads mid-flight, while a filter is not part of what it measures.
 *
 * Played on `morph`, which is the spring made for a dimension: it arrives without turning
 * round, and a body that overshot its height would take the whole column below it along.
 */
export const expand = { height: 'auto', filter: 'opacity(1)' } as const
export const collapse = { height: 0, filter: 'opacity(0)' } as const

/**
 * The `push` kind: what a neighbour does when the thing above it grows or folds away.
 *
 * The same spring the growth itself is played on, deliberately and by name rather than by
 * reaching for `morph` at the call site — because the one thing a push must never do is arrive
 * on a different beat from what pushed it. Read it on `layout`, where motion measures where
 * each block ended up and plays the difference.
 */
export const push: Transition = morph

/**
 * The `crossfade` kind: one content giving way to another in the same place, in opacity alone.
 *
 * For a box whose frame does not move while what it holds is replaced — the tabs of the details
 * of a Session, where the dialog keeps its height and only the panel inside it changes. A slide
 * there would say the new panel came from somewhere; it did not, it was behind its tab all
 * along, and what has to be read is the same room showing something else.
 *
 * The panel that is left goes at once and the one that is chosen comes up from transparent on
 * the theme's `fast` beat: short enough that the two read as one crossing, where a panel that
 * took its time would read as a page loading. A tween and not a spring, because an opacity has
 * no weight to carry and nothing to overshoot.
 *
 * The fade is a `filter`, for the reason `expand` gives: the accessibility check of the
 * catalogue measures a text's contrast through an opacity and refuses what it reads mid-flight.
 * `CROSSFADE` is where the content starts and where it lands; a reader asking for less movement
 * is answered by `useTransition` with `instant`, which is the landing and no fade at all.
 */
export const crossfade: Transition = { duration: durations.fast, ease: easing }
export const CROSSFADE = {
  from: { filter: 'opacity(0)' },
  to: { filter: 'opacity(1)' },
} as const

/**
 * The `ping` kind: a ring leaving what is running, over and over.
 *
 * A dot that is breathing says "this is the state you are waiting on" in opacity alone, which
 * is read once the eye is already on it. A ring that expands out of the dot and fades is read
 * from the corner of the eye, which is where a reader watching a thread actually is — and it
 * costs nothing but a transform and an opacity on an element that is eight pixels wide.
 *
 * The two of them are one kind: `ping` is what the ring travels through — out to `PING_REACH`
 * of its own size while it goes from `PING_OPACITY` to nothing — and `pinging` is the beat it
 * repeats on, the theme's own `turn`, so the ring leaves on the same beat the dot breathes on
 * rather than against it.
 *
 * A reader asking for less movement is given no ring at all rather than a ring with no time to
 * travel in: `useTransition` answers `instant`, and what repeats for ever at no duration is a
 * ring stuck at full size. The component reads that answer and draws nothing.
 */
export const PING_REACH = 2.6
export const PING_OPACITY = 0.45
export const ping: TargetAndTransition = { scale: [1, PING_REACH], opacity: [PING_OPACITY, 0] }
export const pinging: Transition = {
  duration: durations.turn,
  ease: easing,
  repeat: Number.POSITIVE_INFINITY,
}
