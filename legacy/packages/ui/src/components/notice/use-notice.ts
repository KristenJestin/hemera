/** Behaviour of an inline notice: which icon its tone calls for. */

export type NoticeTone = 'info' | 'warn' | 'error' | 'success'

export interface UseNoticeOptions {
  tone: NoticeTone
}

export interface NoticeBehaviour {
  tone: NoticeTone
  /** Icon of the catalogue this tone is announced with. */
  iconName: 'info' | 'triangle-alert' | 'circle-x' | 'circle-check'
}

const ICONS = {
  info: 'info',
  warn: 'triangle-alert',
  error: 'circle-x',
  success: 'circle-check',
} as const

export function useNotice({ tone }: UseNoticeOptions): NoticeBehaviour {
  return { tone, iconName: ICONS[tone] }
}
