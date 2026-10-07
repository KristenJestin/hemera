import { useEffect, useRef, useState } from 'react'

import { followChat, followChats, type ChatState, type ChatsState } from './chats.ts'
import type { Link } from './link.ts'
import type { Following } from './projects.ts'

const LOADING = { kind: 'loading' } as const

/** A Project's Chats, once the engine has answered; none followed without a Project. */
export function useChats(link: Link, engineReady: boolean, projectId: string | null): ChatsState {
  const [state, setState] = useState<ChatsState>(LOADING)
  useEffect(() => {
    if (!engineReady || projectId === null) return undefined
    const following = followChats(link, projectId, setState)
    return () => {
      following.stop()
      setState(LOADING)
    }
  }, [link, engineReady, projectId])
  return state
}

/** The Chat a page shows; and a way to read it again. */
export function useChat(
  link: Link,
  engineReady: boolean,
  projectId: string,
  chatId: string,
): [ChatState, () => void] {
  const [state, setState] = useState<ChatState>(LOADING)
  const following = useRef<Following | null>(null)
  useEffect(() => {
    if (!engineReady) return undefined
    const current = followChat(link, projectId, chatId, setState)
    following.current = current
    return () => {
      current.stop()
      following.current = null
      setState(LOADING)
    }
  }, [link, engineReady, projectId, chatId])
  return [state, () => following.current?.retry()]
}
