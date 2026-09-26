/**
 * The names the Project pages derive rather than ask for: a slug, and what a repository is
 * called when it is offered by name.
 */

/** What a Project's name gives as a slug: lowercase, anything else a dash, no dash at the ends. */
export function slugOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

/** The last segment of a relative path, which is what a repository is called. */
function lastSegmentOf(path: string): string {
  const segments = path
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
  return segments.at(-1) ?? path
}

/**
 * What each repository is called where it is offered by name: the last segment of its path, and
 * the path beside it when two of them end the same way — two `api` folders are two choices a
 * reader has to be able to tell apart.
 */
export function repositoryNamesOf(paths: readonly string[]): Map<string, string> {
  const counted = new Map<string, number>()
  for (const path of paths) {
    const name = lastSegmentOf(path)
    counted.set(name, (counted.get(name) ?? 0) + 1)
  }
  return new Map(
    paths.map((path) => {
      const name = lastSegmentOf(path)
      return [path, (counted.get(name) ?? 0) > 1 ? `${name} (${path})` : name]
    }),
  )
}
