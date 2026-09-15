/** The complete dark theme. Values extracted from the prototype (design.md, D12a). */

import { darkShadow, palette } from '#tokens/primitives.ts'
import type { Theme } from '#tokens/semantic.ts'

export const dark: Theme = {
  name: 'dark',
  colors: {
    bg: palette.neutral0,
    surface: palette.neutral150,
    surface2: palette.neutral50,
    surface3: palette.neutral75,
    line: palette.neutral200,
    line2: palette.neutral300,
    text: palette.paper,
    muted: palette.neutral700,
    dim: palette.neutral500,

    primary: palette.fuchsia400,
    primaryStrong: palette.fuchsia500,
    primarySoft: palette.fuchsia400Alpha10,
    primarySoft2: palette.fuchsia400Alpha18,
    primaryRing: palette.fuchsia400Alpha30,
    primaryText: palette.fuchsia300,
    // Derived, not extracted: the prototype writes this colour inline in several rules.
    onPrimary: palette.white,

    ok: palette.green400,
    okSoft: palette.green400Alpha10,
    warn: palette.amber400,
    warnSoft: palette.amber400Alpha10,
    bad: palette.red400,
    badSoft: palette.red400Alpha10,
    info: palette.blue400,
    infoSoft: palette.blue400Alpha10,

    missionDefine: palette.violet400,
    missionDefineSoft: palette.violet400Alpha12,
    missionBuild: palette.cyan400,
    missionBuildSoft: palette.cyan400Alpha10,
    missionFree: palette.neutral700,
    missionFreeSoft: palette.neutral700Alpha12,

    scrim: palette.scrim,
    // Derived, not extracted: the prototype has no pressed state.
    pressTint: palette.pressDark,
    tooltipBg: palette.neutral100,
    tooltipText: palette.neutral950,
  },
  shadows: darkShadow,
}
