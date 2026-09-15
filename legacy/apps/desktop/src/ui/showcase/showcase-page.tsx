/**
 * Demonstration page of the design system.
 *
 * It renders every component of the catalogue in all its variants and states, and switches
 * themes in place. It is reachable only from a `dev` package: no route, no navigation entry
 * and no shortcut exposes it otherwise.
 */

import {
  Button,
  Scroll,
  Separator,
  Stack,
  Text,
  ThemeProvider,
  space,
  useTheme,
  useThemeControl,
} from '@hemera/ui'
import { SHOWCASE } from '@hemera/ui/showcase'
import type { ThemeName } from '@hemera/ui'
import { useState } from 'react'

import * as m from '#paraglide/messages.js'

function ThemeSwitch() {
  const control = useThemeControl()
  return (
    <Stack gap="md" align="center">
      <Text color="muted" scale="sm">
        {m.showcase_theme()}
      </Text>
      <Button
        label={control.name === 'dark' ? m.showcase_theme_light() : m.showcase_theme_dark()}
        size="sm"
        onPress={() => control.setTheme(control.name === 'dark' ? 'light' : 'dark')}
      />
    </Stack>
  )
}

function Catalogue({ onClose }: { onClose?: (() => void) | undefined }) {
  const theme = useTheme()
  return (
    <Scroll style={{ backgroundColor: theme.colors.bg, height: '100%' }}>
      <Stack direction="column" gap="2xl" style={{ padding: space['2xl'] }}>
        <Stack gap="lg" align="center" justify="between">
          <Text color="text" scale="display" weight="semibold">
            {m.showcase_title()}
          </Text>
          <Stack gap="md" align="center">
            <ThemeSwitch />
            {onClose === undefined ? null : (
              <Button
                testId="showcase-close"
                label={m.showcase_close()}
                size="sm"
                iconName="chevron-left"
                onPress={onClose}
              />
            )}
          </Stack>
        </Stack>

        {SHOWCASE.map((entry) => (
          <Stack key={entry.component} direction="column" gap="lg" align="start">
            <Text color="text" scale="xl" weight="semibold">
              {entry.component}
            </Text>
            <Separator />
            {entry.cases.map((demonstration) => (
              <Stack key={demonstration.name} direction="column" gap="md" align="start">
                <Text color="dim" scale="xs" weight="semibold">
                  {demonstration.name}
                </Text>
                {demonstration.render()}
              </Stack>
            ))}
          </Stack>
        ))}
      </Stack>
    </Scroll>
  )
}

export interface ShowcasePageProps {
  /** Theme the page starts on; switching it never leaves the page. */
  initialTheme?: ThemeName
  /** Back to the sessions. Absent when the page is opened on its own. */
  onClose?: () => void
}

export function ShowcasePage({ initialTheme = 'dark', onClose }: ShowcasePageProps) {
  const [theme, setTheme] = useState<ThemeName>(initialTheme)
  return (
    <ThemeProvider name={theme} onThemeChange={setTheme}>
      <Catalogue onClose={onClose} />
    </ThemeProvider>
  )
}
