import type { ReactDoctorConfig } from 'react-doctor/api'

/**
 * React Doctor, the React-specific check beside oxlint: `pnpm run doctor`, gated in CI at error level.
 *
 * Nothing leaves the machine: the score is computed by React Doctor's server from the findings, so
 * it is off, and so is the supply-chain pass, which asks Socket about every dependency. The
 * crash reports and usage counters are turned off by `--no-telemetry` in the script itself, since
 * the CLI reads that switch before it reads this file.
 */
export default {
  projects: ['packages/ui', 'apps/desktop/src/renderer'],
  noScore: true,
  share: false,
  supplyChain: { enabled: false },
  rules: {
    'react-doctor/require-pnpm-hardening': 'warn',
  },
  ignore: {
    overrides: [
      // A dialog body grows with what it holds on `morph`, by design (packages/ui/AGENTS.md, interface conventions).
      {
        files: ['src/components/dialog/dialog.tsx'],
        rules: ['react-doctor/no-layout-property-animation'],
      },
    ],
  },
} satisfies ReactDoctorConfig
