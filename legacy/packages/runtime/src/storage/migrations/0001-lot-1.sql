-- Lot 1: projects, workspaces, repositories, sessions, entries, journal, preferences.
-- Forward-only and cumulative: a later lot adds its own migration rather than editing this.

CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  spec_key_prefix TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspaces_project_name ON workspaces (project_id, name);
--> statement-breakpoint
CREATE TABLE project_repositories (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  rank TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_repositories_path ON project_repositories (project_id, relative_path);
--> statement-breakpoint
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_chosen INTEGER NOT NULL DEFAULT 0,
  mission TEXT,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE INDEX sessions_project ON sessions (project_id, archived_at);
--> statement-breakpoint
CREATE TABLE session_entries (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  rank TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX session_entries_rank ON session_entries (session_id, rank);
--> statement-breakpoint
CREATE TABLE domain_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  author TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  project_id TEXT,
  session_id TEXT,
  spec_id TEXT,
  revision_id TEXT,
  phase_id TEXT,
  payload TEXT
);
--> statement-breakpoint
CREATE INDEX domain_events_project ON domain_events (project_id, sequence);
--> statement-breakpoint
CREATE INDEX domain_events_session ON domain_events (session_id, sequence);
--> statement-breakpoint
CREATE TABLE app_preferences (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
-- Technical output is kept apart from the journal: a long stream is read in blocks in its
-- own execution context and is never an event of the journal.
CREATE TABLE activity_output (
  id TEXT PRIMARY KEY NOT NULL,
  context_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  stream TEXT NOT NULL,
  content TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX activity_output_block ON activity_output (context_id, block_index);
