/** The complete light theme. Values extracted from the prototype (design.md, D12a). */

import { lightShadow, palette } from '../tokens/primitives.ts'
import type { Theme } from '../tokens/semantic.ts'

export const light: Theme = {
  name: 'light',
  colors: {
    bg: palette.neutral900,
    surface: palette.white,
    surface2: palette.neutral975,
    surface3: palette.neutral875,
    line: palette.neutral850,
    line2: palette.neutral800,
    text: palette.ink,
    muted: palette.neutral600,
    dim: palette.neutral650,

    primary: palette.fuchsia500,
    primaryStrong: palette.fuchsia600,
    primarySoft: palette.fuchsia50,
    primarySoft2: palette.fuchsia100,
    primaryRing: palette.fuchsia500Alpha25,
    primaryText: palette.fuchsia700,
    // Derived, not extracted: the prototype writes this colour inline in several rules.
    onPrimary: palette.white,

    ok: palette.green500,
    okSoft: palette.green50,
    warn: palette.amber600,
    warnSoft: palette.amber50,
    bad: palette.red600,
    badSoft: palette.red50,
    info: palette.blue600,
    infoSoft: palette.blue50,

    missionDefine: palette.violet600,
    missionDefineSoft: palette.violet50,
    missionBuild: palette.cyan600,
    missionBuildSoft: palette.cyan50,
    missionFree: palette.neutral600,
    missionFreeSoft: palette.neutral925,

    scrim: palette.scrim,
    // Derived, not extracted: the prototype has no pressed state.
    pressTint: palette.pressLight,
    tooltipBg: palette.neutral100,
    tooltipText: palette.neutral950,
  },
  shadows: lightShadow,
}
