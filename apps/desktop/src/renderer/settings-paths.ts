/** A folder chosen with the picker, as a path in the main checkout when it is in it. */
export function inMainCheckout(mainCheckout: string, folder: string): string {
  const slash = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '')
  const root = slash(mainCheckout)
  const chosen = slash(folder)
  if (chosen === root) return '.'
  return chosen.startsWith(`${root}/`) ? chosen.slice(root.length + 1) : folder
}

/** Hemera's own folder for a Project's Workspaces, written the way the data folder is. */
export function defaultWorkspacesFolder(dataFolder: string, projectId: string): string {
  const separator = dataFolder.includes('\\') ? '\\' : '/'
  return [dataFolder.replace(/[\\/]+$/, ''), 'workspaces', projectId].join(separator)
}

/** A prefix as the engine keeps it: without the slash the branch puts after it. */
export function keptPrefix(prefix: string | null): string | null {
  const kept = prefix?.trim().replace(/\/+$/, '') ?? ''
  return kept === '' ? null : kept
}
