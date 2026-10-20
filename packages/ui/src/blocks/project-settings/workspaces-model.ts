/** The branch a mission's Workspace is made on: the prefix, then a slash unless it ends with one. */
export function workspaceBranchOf(prefix: string, mission: string): string {
  return prefix.endsWith('/') ? `${prefix}${mission}` : `${prefix}/${mission}`
}

/** The folder a mission's Workspace is made in, under the Workspaces folder. */
export function workspaceFolderOf(folder: string, mission: string): string {
  return `${folder.replace(/[/\\]+$/, '')}/${mission}`
}
