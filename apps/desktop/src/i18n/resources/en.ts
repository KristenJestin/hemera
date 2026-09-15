/**
 * English translation resources. English is the only locale shipped in v1; adding a locale
 * means adding a sibling file, never editing a component.
 */
export const en = {
  'app.name': 'Hemera',
  'showcase.title': 'Design system',
  'showcase.open': 'Design system',
  'showcase.close': 'Back to the sessions',
  'showcase.theme': 'Theme',
  'showcase.theme.light': 'Switch to light',
  'showcase.theme.dark': 'Switch to dark',

  'action.cancel': 'Cancel',

  settings: 'Settings',
  'settings.application': 'Application',
  'settings.project': 'Project',
  'settings.theme': 'Appearance',

  'window.minimize': 'Minimise the window',
  'window.maximize': 'Maximise the window',
  'window.close': 'Close the window',

  'shell.sidebar.collapse': 'Collapse the sidebar',
  'shell.sidebar.resize': 'Sidebar width',

  'project.new': 'New project',
  'project.new.name': 'Project name',
  'project.new.name.placeholder': 'Name of the project',
  'project.new.path': 'Folder of the main workspace',
  'project.new.path.placeholder': 'Path of an existing folder',
  'project.new.confirm': 'Create the project',
  'project.settings': 'Project configuration',
  'project.settings.name': 'Project name',
  'project.settings.repositories': 'Repository locations',
  'project.settings.repositories.add': 'Add a repository',
  'project.settings.repositories.remove': 'Remove this repository',
  'project.settings.repositories.placeholder': './sources/api',
  'project.settings.repositories.hint':
    'Relative to the workspace root. Leave empty to use the root itself.',
  'project.settings.save': 'Save the configuration',
  'project.folder': 'Folder',
  'project.unavailable': 'The folder of this project cannot be read. Its data is kept.',
  'project.none.title': 'No project yet',
  'project.none.description': 'Create a project around a folder you already have.',

  'session.new': 'New session',
  'session.none.title': 'No session yet',
  'session.none.description': 'A session holds a thread of messages for this project.',
  'session.none.archived.title': 'No archived session',
  'session.none.archived.description': 'Archiving a session moves it here; nothing is deleted.',
  'session.open.none.title': 'No session open',
  'session.open.none.description': 'Pick a session in the sidebar, or start a new one.',
  'session.archive': 'Archive this session',
  'session.restore': 'Restore this session',
  'session.rename': 'Rename this session',
  'session.rename.title': 'Rename the session',
  'session.rename.field': 'Session title',
  'session.rename.confirm': 'Rename',
  'session.archived.show': 'Archived sessions',
  'session.archived.hide': 'Current sessions',
  'session.send': 'Send',
  'session.composer.placeholder': 'Write a message…',
  'session.composer.label': 'Message to send',
} as const
