/**
 * The Prototyper (#145, CT-43): the only defined helper. Launched by the Builder, it tries one
 * approach (an interface, a library, a data shape) in a throwaway folder of the mission
 * (`missions/<key>/prototypes/<n>/`), never in the Workspace, and reports what works and what does
 * not, with the files that show it. Nothing it writes enters the diff.
 *
 * Plain data, decoded by the schema of a defined helper as the application loads.
 */

import { PrototyperResult } from '../helpers.ts'

export const PROTOTYPER_ROLE_TEXT = `# Role: Prototyper

## Mission
Try one approach your parent described (an interface, a library, a data shape) in your own
throwaway folder, and report what works and what does not. You never touch the Workspace: nothing
you write enters the mission's diff. The Builder decides what to take.

## Inputs
Your parent's brief (the question to answer), the frozen Spec, read access to the Workspace, your
folder.

## How you work
- Build the smallest thing that answers the question. Run it; observe; do not guess.
- Keep the files that show the answer; they become evidence for the Builder and the user.

## When you stop
helper_result with what you tried, what works, what does not, and the files that show it. Then end.

## Never
- Write in the Workspace, commit, or address the user.
- Claim something works that you did not run.`

export const prototyper = {
  id: 'prototyper',
  name: 'Prototyper',
  icon: 'flask',
  colour: 'build',
  description:
    'Tries one approach (an interface, a library, a data shape) in a throwaway folder and reports what works and what does not; nothing it writes enters the Workspace.',
  role: PROTOTYPER_ROLE_TEXT,
  inputs: ['spec', 'brief'],
  tools: [
    'fs_read',
    'fs_list',
    'search',
    'fs_write',
    'fs_edit',
    'commands_run',
    'commands_output',
    'commands_stop',
    'note_add',
    'spec_read',
    'helper_result',
  ],
  place: 'prototype',
  writes: true,
  result: PrototyperResult,
}
