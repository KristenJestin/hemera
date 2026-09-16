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
  PROFILE_REQUESTS,
  channelSchema,
  displayPreferencesChangeSchema,
  displayPreferencesSchema,
  profileStatusSchema,
  sidebarPreferenceSchema,
  themePreferenceSchema,
} from './profile.ts'
export type {
  Channel,
  DisplayPreferences,
  DisplayPreferencesChange,
  ProfileArguments,
  ProfileRequestName,
  ProfileRequests,
  ProfileResponse,
  ProfileStatus,
  SidebarPreference,
  ThemePreference,
} from './profile.ts'
