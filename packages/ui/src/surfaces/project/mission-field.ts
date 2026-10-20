import { createContext, type RefObject } from 'react'

/**
 * The field that starts a mission, as the Project's tasks reach it: a task leaving the page while
 * the focus is in it hands the focus there rather than to nothing. The page provides the ref; the
 * field takes it as its `inputRef`.
 */
export const MissionField = createContext<RefObject<HTMLInputElement | null> | null>(null)
