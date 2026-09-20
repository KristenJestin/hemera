/**
 * The thread of a Session, grouped by domain and not by screen (design D4b-08).
 *
 * The pieces a page puts a conversation together with: the messages themselves, and the
 * scrolling that follows the live edge. The Session page assembles them; nothing here knows
 * what a Session is.
 */

export {
  LiveMarker,
  MessageBubble,
  MessageDaySeparator,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  MessageRow,
  type MessageBubbleProps,
  type MessageFooterProps,
  type MessageGroupProps,
  type MessageHeaderProps,
  type MessageRowProps,
  type MessageSide,
  type MessageState,
} from './message.tsx'
export { MessageScroller, type MessageScrollerProps } from './scroller/scroller.tsx'
export {
  LatestPill,
  NavigationRail,
  type LatestPillProps,
  type NavigationRailProps,
  type NavigationTick,
} from './scroller/navigation-rail.tsx'
export { LIVE_EDGE_THRESHOLD, atLiveEdge, distanceToLiveEdge } from './scroller/live-edge.ts'
