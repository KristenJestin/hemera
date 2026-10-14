/** The names Hemera fills in a value or a line, and what each is filled with. */
export const TEMPLATE_NAMES = [
  { name: '{workspace}', filled: 'Workspace name' },
  { name: '{workspace.path}', filled: 'Workspace folder' },
  { name: '{project}', filled: 'Project, as a slug' },
  { name: '{branch}', filled: 'Workspace branch' },
] as const
