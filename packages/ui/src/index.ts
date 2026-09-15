/**
 * The public surface of the design system: the components the application composes with.
 *
 * The theme, the motion preset, the icon catalogue and the window colours are reached
 * through their own subpaths, because the bundler and the main process need them alone.
 */

export {
  Button,
  IconButton,
  type ButtonProps,
  type ButtonState,
  type IconButtonProps,
} from './components/button/button.tsx'
export { Badge, type BadgeProps } from './components/badge/badge.tsx'
export { Loading, type LoadingProps } from './components/loading/loading.tsx'
