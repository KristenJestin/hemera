/** Public surface of the channel declaration shared by the main process and the renderer. */

export { CHANNELS, windowCommandSchema } from './channels.ts'
export type {
  Bridge,
  ChannelArguments,
  ChannelName,
  ChannelResponse,
  Channels,
} from './channels.ts'
export {
  displaySchema,
  environmentReportSchema,
  graphicsSchema,
  motionMeasureSchema,
  versionsSchema,
} from './environment.ts'
export type {
  Display,
  EnvironmentReport,
  Graphics,
  MotionMeasure,
  Versions,
} from './environment.ts'
export {
  DEFAULT_DISPLAY_PREFERENCES,
  ENGINE_REQUESTS,
  channelSchema,
  displayPreferencesChangeSchema,
  activeProjectSchema,
  displayPreferencesSchema,
  engineStatusSchema,
  entityKindSchema,
  eventAuthorSchema,
  eventSourceSchema,
  journalEntrySchema,
  projectSchema,
  projectToneSchema,
  sidebarPreferenceSchema,
  themePreferenceSchema,
} from './engine.ts'
export type {
  Channel,
  DisplayPreferences,
  DisplayPreferencesChange,
  EngineArguments,
  EngineRequestName,
  EngineRequests,
  EngineResponse,
  EngineStatus,
  SidebarPreference,
  ThemePreference,
  JournalEntry,
  Project,
} from './engine.ts'
