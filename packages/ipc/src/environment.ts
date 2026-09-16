/**
 * The shape of the environment report (design D0-07).
 *
 * It lives here rather than beside the code that fills it in because it is what crosses the
 * bridge: the main process produces it, the renderer reads it, and both read the same schema.
 */

import { z } from 'zod'

import { channelSchema } from './profile.ts'

export const displaySchema = z.object({
  /** Identifier the platform gives the display, so two reports can be compared. */
  id: z.number(),
  width: z.number(),
  height: z.number(),
  /** 1, 1.5, 1.6 … whatever the target applies to this display alone. */
  scaleFactor: z.number(),
  /** Refresh rate in hertz, 0 when the platform does not say. */
  refreshRate: z.number(),
  primary: z.boolean(),
})

export const graphicsSchema = z.object({
  /** `wayland`, `x11`, `windows`, or what the target answered. */
  session: z.string(),
  /** The compositor or desktop, when the target names one. */
  compositor: z.string().nullable(),
  /** The backend the GPU process actually runs on, read from its command line. */
  gpuBackend: z.string().nullable(),
  /** The adapter the GPU process ended up on, null when it reported none. */
  device: z.string().nullable(),
  /** `app.getGPUFeatureStatus()`, feature by feature. */
  features: z.record(z.string(), z.string()),
})

export const versionsSchema = z.object({
  electron: z.string(),
  chrome: z.string(),
  node: z.string(),
})

export const motionMeasureSchema = z.object({
  /** Refresh rate the transition was measured against. */
  refreshRate: z.number(),
  frames: z.number(),
  /** Longest frame of the transition, in milliseconds. */
  longestFrame: z.number(),
})

export const environmentReportSchema = z.object({
  /** What the application calls itself: the version a package carries, or the repository's label. */
  version: z.string(),
  /** Which build produced this report, and therefore which profile it was speaking from. */
  channel: channelSchema,
  /** The target this report was produced on: `windows` or `linux`. */
  platform: z.string(),
  osVersion: z.string(),
  /** Distribution or edition, when the target names one. */
  distribution: z.string().nullable(),
  graphics: graphicsSchema,
  displays: z.array(displaySchema),
  versions: versionsSchema,
  /** Filled in by the renderer once the witness transition has been measured. */
  motion: motionMeasureSchema.nullable(),
  /** Targets and checks this report does not speak for, named rather than left out. */
  notVerified: z.array(z.string()),
  producedAt: z.string(),
})

export type Display = z.infer<typeof displaySchema>
export type Graphics = z.infer<typeof graphicsSchema>
export type Versions = z.infer<typeof versionsSchema>
export type MotionMeasure = z.infer<typeof motionMeasureSchema>
export type EnvironmentReport = z.infer<typeof environmentReportSchema>
