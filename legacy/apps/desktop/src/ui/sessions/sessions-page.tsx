/**
 * The session screen: the projects bar, the sessions of the active project and the thread of
 * the session in view.
 *
 * No provider is configured and no agent answers: the composer records what the user writes,
 * and nothing else ever appears in the thread. A message whose recording is refused stays in
 * the composer, so the text is never lost to a failure.
 */

import {
  Button,
  Composer,
  EmptyState,
  IconButton,
  NavItem,
  Notice,
  Scroll,
  Stack,
  Tab,
  Text,
  TimelineItem,
  WindowShell,
  space,
} from '@hemera/ui'
import type { ThemeColors, WindowCommands } from '@hemera/ui'
import { useState } from 'react'

import * as m from '#paraglide/messages.js'
import { NewProjectDialog, RenameSessionDialog, SettingsDialog } from './dialogs.tsx'
import type { SessionsModel } from './use-sessions.ts'

/** Colours projects are marked with in the bar, in order. */
const PROJECT_COLORS: (keyof ThemeColors)[] = ['primary', 'ok', 'info', 'warn', 'missionDefine']

/** Decisions laid over the window; only one is open at a time. */
type Overlay = 'none' | 'new-project' | 'settings' | 'rename'

export interface SessionsPageProps {
  model: SessionsModel
  /** The renderer's window commands, when the window was opened without its native frame. */
  windowCommands?: WindowCommands
  framelessWindow?: boolean
  /** Opens the design system demonstration. Absent from a package that does not expose it. */
  onOpenShowcase?: () => void
}

export function SessionsPage({
  model,
  windowCommands,
  framelessWindow,
  onOpenShowcase,
}: SessionsPageProps) {
  const [draft, setDraft] = useState('')
  const [overlay, setOverlay] = useState<Overlay>('none')

  const close = () => setOverlay('none')

  // The draft only leaves the composer once the profile accepted it.
  const send = (body: string) => {
    if (model.sendMessage(body)) setDraft('')
  }

  const projects = (
    <>
      {model.projects.map((project, index) => (
        <Tab
          key={project.id}
          testId={`project-${project.id}`}
          label={project.name}
          dotColor={PROJECT_COLORS[index % PROJECT_COLORS.length] ?? 'primary'}
          active={project.id === model.activeProjectId}
          onSelect={() => model.selectProject(project.id)}
        />
      ))}
      <IconButton
        testId="new-project"
        name="plus"
        label={m.project_new()}
        size="sm"
        onPress={() => setOverlay('new-project')}
      />
      {model.activeProject === null ? null : (
        <IconButton
          testId="project-settings"
          name="settings"
          label={m.settings()}
          size="sm"
          onPress={() => setOverlay('settings')}
        />
      )}
      {onOpenShowcase === undefined ? null : (
        <IconButton
          testId="open-showcase"
          name="search"
          label={m.showcase_open()}
          size="sm"
          onPress={onOpenShowcase}
        />
      )}
    </>
  )

  const sidebar = (
    <Stack direction="column" gap="sm">
      {model.showingArchived || model.archivedCount > 0 ? (
        <Button
          testId="toggle-archived"
          label={model.showingArchived ? m.session_archived_hide() : m.session_archived_show()}
          tone="ghost"
          size="sm"
          iconName={model.showingArchived ? 'message-square' : 'archive'}
          onPress={() => model.showArchived(!model.showingArchived)}
        />
      ) : null}

      {model.sessions.length === 0 ? (
        <EmptyState
          testId="no-session"
          iconName="inbox"
          title={model.showingArchived ? m.session_none_archived_title() : m.session_none_title()}
          description={
            model.showingArchived
              ? m.session_none_archived_description()
              : m.session_none_description()
          }
          {...(model.showingArchived || model.activeProjectId === null
            ? {}
            : { actionLabel: m.session_new(), onAction: model.startSession })}
        />
      ) : (
        <>
          {model.sessions.map((session) => (
            <NavItem
              key={session.id}
              testId={`session-${session.id}`}
              label={session.title}
              iconName={session.archivedAt === null ? 'message-square' : 'archive'}
              selected={session.id === model.activeSessionId}
              onSelect={() => model.selectSession(session.id)}
            />
          ))}
          {model.showingArchived ? null : (
            <Button
              testId="new-session"
              label={m.session_new()}
              tone="secondary"
              size="sm"
              iconName="plus"
              onPress={model.startSession}
            />
          )}
        </>
      )}
    </Stack>
  )

  // A decision is laid over the window by the shell. Rendered in the content it would take
  // its place: the thread and its composer would stop existing while the panel is open.
  const decision =
    overlay === 'new-project' ? (
      <NewProjectDialog onClose={close} onCreate={model.addProject} />
    ) : overlay === 'settings' && model.configuration !== null ? (
      <SettingsDialog
        configuration={model.configuration}
        path={model.activeProjectPath}
        theme={model.theme}
        onThemeChange={model.setTheme}
        onClose={close}
        onSave={model.configureProject}
      />
    ) : overlay === 'rename' && model.activeSession !== null ? (
      <RenameSessionDialog
        title={model.activeSession.title}
        onClose={close}
        onRename={model.renameSession}
      />
    ) : null

  return (
    <WindowShell
      testId="shell"
      collapseLabel={m.shell_sidebar_collapse()}
      resizeLabel={m.shell_sidebar_resize()}
      sidebarWidth={model.sidebarWidth}
      onSidebarWidthChange={model.setSidebarWidth}
      sidebarCollapsed={model.sidebarCollapsed}
      onSidebarCollapsedChange={model.setSidebarCollapsed}
      projects={projects}
      sidebar={sidebar}
      windowLabels={{
        minimize: m.window_minimize(),
        maximize: m.window_maximize(),
        close: m.window_close(),
      }}
      {...(windowCommands === undefined ? {} : { windowCommands })}
      {...(framelessWindow === undefined ? {} : { framelessWindow })}
      {...(decision === null ? {} : { overlay: decision })}
    >
      <Stack
        direction="column"
        gap="lg"
        style={{ padding: space['2xl'], flexGrow: 1, minHeight: 0 }}
      >
        {model.unavailableFolder === null ? null : (
          <Notice testId="folder-unavailable" tone="warn" message={m.project_unavailable()} />
        )}
        {model.failure === null ? null : (
          <Notice testId="failure" tone="error" message={model.failure} />
        )}

        {model.activeProjectId === null ? (
          <EmptyState
            testId="no-project"
            iconName="folder"
            title={m.project_none_title()}
            description={m.project_none_description()}
            actionLabel={m.project_new()}
            onAction={() => setOverlay('new-project')}
          />
        ) : model.activeSession === null ? (
          <EmptyState
            testId="no-thread"
            iconName="message-square"
            title={m.session_open_none_title()}
            description={m.session_open_none_description()}
          />
        ) : (
          <Thread
            model={model}
            draft={draft}
            onDraftChange={setDraft}
            onSend={send}
            onRename={() => setOverlay('rename')}
          />
        )}
      </Stack>
    </WindowShell>
  )
}

interface ThreadProps {
  model: SessionsModel
  draft: string
  onDraftChange: (draft: string) => void
  onSend: (body: string) => void
  onRename: () => void
}

/** The thread of the session in view, with the composer that records into it. */
function Thread({ model, draft, onDraftChange, onSend, onRename }: ThreadProps) {
  const session = model.activeSession
  if (session === null) return null
  const archived = session.archivedAt !== null

  return (
    <>
      <Stack gap="md" align="center" justify="between">
        <Text color="text" scale="xl" weight="semibold" truncate testId="session-title">
          {session.title}
        </Text>
        <Stack gap="sm" align="center">
          <IconButton
            testId="rename-session"
            name="pencil"
            label={m.session_rename()}
            size="sm"
            onPress={onRename}
          />
          <IconButton
            testId="archive-session"
            name={archived ? 'archive-restore' : 'archive'}
            label={archived ? m.session_restore() : m.session_archive()}
            size="sm"
            onPress={() => model.setArchived(session.id, !archived)}
          />
        </Stack>
      </Stack>

      <Scroll testId="thread" style={{ flexGrow: 1, minHeight: 0 }}>
        <Stack direction="column">
          {model.messages.map((entry) => (
            <TimelineItem
              key={entry.id}
              testId={`message-${entry.id}`}
              message={entry.body}
              at={new Date(entry.createdAt)}
              now={new Date(model.now)}
              dotColor="primary"
            />
          ))}
        </Stack>
      </Scroll>

      <Composer
        testId="composer"
        draft={draft}
        onDraftChange={onDraftChange}
        onSend={onSend}
        disabled={archived}
        placeholder={m.session_composer_placeholder()}
        aria-label={m.session_composer_label()}
        footer={
          <Button
            testId="send"
            label={m.session_send()}
            tone="primary"
            size="sm"
            disabled={archived || draft.trim().length === 0}
            onPress={() => onSend(draft)}
          />
        }
      />
    </>
  )
}
