/**
 * The ticket providers of a Project, in its settings (#104): the list of its GitHub and Jira
 * providers over the link, and the dialogs that add one, mend one, give it a Jira token or remove
 * it. A dialog's draft is held outside React's state, so its body and its foot read it in the same
 * render. No Effect here: the link's calls are promises. A Jira token goes from its field to the
 * link in one call and is never kept: only where it stands is read back.
 */

import type { Project } from '@hemera/ipc'
import {
  FormFoot,
  GithubForm,
  type GithubDraft,
  JiraForm,
  ProviderDetails,
  ProviderMark,
  type ProviderView,
  TicketProviders,
  TokenField,
  providerProblem,
  providerTitle,
  type SettingsForm,
} from '@hemera/ui'
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'

import type { Link } from './link.ts'
import {
  type GithubAddDraft,
  type JiraAddDraft,
  type ProviderStore,
  type ProvidersState,
  checkProvider,
  dropToken,
  giveToken,
  githubConfigOf,
  githubEdited,
  githubRefusal,
  proposalsArrived,
  providerStore,
  providerViewsOf,
  readProvider,
  removalWords,
  submitJira,
} from './ticket-providers-model.ts'

export interface ProvidersPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  project: Project | null
  show: (form: SettingsForm | null) => void
  copy: (text: string) => void
}

/** What the section has read, and why it could not read more. */
interface Read extends ProvidersState {
  readonly error: string | undefined
}

const NOTHING_READ: Read = {
  infos: null,
  statuses: new Map(),
  tokens: new Map(),
  error: undefined,
}

/** How long a field waits for the typing to settle before the engine is asked about it. */
const TYPING_SETTLES_MS = 500

const nothing = (): void => undefined

/** The providers of a Project as the engine holds them, followed while the section is there. */
function useProviderStore(
  link: Link,
  engineReady: boolean,
  projectId: string | null,
): ProviderStore<Read> {
  const [store] = useState(() => providerStore<Read>(NOTHING_READ))
  useEffect(() => {
    store.set(NOTHING_READ)
    if (!engineReady || projectId === null) return undefined
    return link.onTicketSettings(
      projectId,
      (settings) => {
        store.set({ infos: settings.providers, error: undefined })
        for (const provider of settings.providers) readProvider(link, store, provider)
      },
      (failure) =>
        store.set({ error: `The ticket providers could not be read: ${failure.message}` }),
    )
  }, [link, engineReady, projectId, store])
  return store
}

function useStored<T extends object>(store: ProviderStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/**
 * What is wrong with a Project's ticket providers, in a sentence, for the section's glyph in the
 * settings list; undefined when nothing is.
 */
export function useTicketProblem(
  link: Link,
  engineReady: boolean,
  projectId: string | null,
): string | undefined {
  const store = useProviderStore(link, engineReady, projectId)
  const views = providerViewsOf(useStored(store), new Date())
  return views === null ? undefined : providerProblem(views)
}

/** What a provider's dialog holds beside the engine's records. */
interface ProviderDraft {
  readonly github: GithubDraft
  /** The repositories proposed for the host. */
  readonly proposed: ReadonlyArray<string>
  readonly checking: boolean
  readonly saving: boolean
  readonly tokenSaving: boolean
  readonly tokenRefused: string | undefined
  /** Why the last save, check or removal was refused, in words. */
  readonly refused: string | undefined
}

interface DialogProps {
  link: Link
  projectId: string
}

interface ProviderDialogProps extends DialogProps {
  store: ProviderStore<Read>
  draft: ProviderStore<ProviderDraft>
  id: string
  copy: (text: string) => void
}

/** Asks for the repositories proposed for a host once its typing settles. */
function useProposals(
  link: Link,
  projectId: string,
  host: string,
  answered: (proposed: ReadonlyArray<string>) => void,
): void {
  useEffect(() => {
    if (host.trim() === '') return undefined
    let current = true
    const timer = setTimeout(() => {
      link.proposeGithub(projectId, host.trim().toLowerCase()).then((proposed) => {
        if (current) answered(proposed)
      }, nothing)
    }, TYPING_SETTLES_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [link, projectId, host])
}

function ProviderBody({ link, projectId, store, draft, id, copy }: ProviderDialogProps): ReactNode {
  const state = useStored(store)
  const mine = useStored(draft)
  const view = providerViewsOf(state, new Date())?.find((one) => one.id === id)
  const info = state.infos?.find((one) => one.id === id)
  useProposals(link, projectId, info?.kind === 'github' ? mine.github.host : '', (proposed) =>
    draft.set({ proposed }),
  )
  if (view === undefined || info === undefined) return null
  const saveToken = (token: string): void => {
    draft.set({ tokenSaving: true, tokenRefused: undefined })
    giveToken(link, store, info, token).then(
      (status) =>
        draft.set({
          tokenSaving: false,
          tokenRefused: status === 'invalid' ? 'Jira refused this token.' : undefined,
        }),
      (failure: Error) =>
        draft.set({
          tokenSaving: false,
          tokenRefused: `The token could not be saved: ${failure.message}`,
        }),
    )
  }
  const removeToken = (): void => {
    dropToken(link, store, info).then(undefined, (failure: Error) =>
      draft.set({ refused: `The token could not be removed: ${failure.message}` }),
    )
  }
  const checkAgain = (): void => {
    draft.set({ checking: true, refused: undefined })
    checkProvider(link, store, id).then(
      () => draft.set({ checking: false }),
      (failure: Error) =>
        draft.set({
          checking: false,
          refused: `The provider could not be checked: ${failure.message}`,
        }),
    )
  }
  return (
    <ProviderDetails
      provider={view}
      jira={
        info.jira === null
          ? undefined
          : { deployment: info.jira.deployment, email: info.jira.email }
      }
      checking={mine.checking}
      onCheckAgain={checkAgain}
      onCopy={copy}
      edit={
        info.kind === 'github' ? (
          <GithubForm
            draft={mine.github}
            onChange={(github) => draft.set({ github })}
            proposed={mine.proposed}
          />
        ) : undefined
      }
      token={
        view.token === undefined ? undefined : (
          <TokenField
            status={view.token}
            deployment={info.jira?.deployment}
            saving={mine.tokenSaving}
            refused={mine.tokenRefused}
            onSave={saveToken}
            onRemove={removeToken}
          />
        )
      }
    />
  )
}

function ProviderFoot({
  link,
  store,
  draft,
  id,
  close,
}: Omit<ProviderDialogProps, 'projectId' | 'copy'> & { close: () => void }): ReactNode {
  const mine = useStored(draft)
  const github = useStored(store).infos?.find((one) => one.id === id)?.kind === 'github'
  return (
    <FormFoot
      refused={mine.refused}
      remove="Remove this provider"
      onRemove={() => {
        draft.set({ refused: undefined })
        link
          .removeProvider(id)
          .then(close, (failure: Error) => draft.set({ refused: removalWords(failure) }))
      }}
      save={github ? 'Save' : 'Done'}
      saving={mine.saving}
      onSave={() => {
        if (!github) {
          close()
          return
        }
        const refusal = githubRefusal(mine.github)
        if (refusal !== undefined) {
          draft.set({ refused: refusal })
          return
        }
        draft.set({ saving: true, refused: undefined })
        link
          .updateProvider(id, githubConfigOf(mine.github))
          .then(close, (failure: Error) => draft.set({ saving: false, refused: failure.message }))
      }}
      onCancel={close}
    />
  )
}

function GithubAddBody({
  link,
  projectId,
  draft,
}: DialogProps & { draft: ProviderStore<GithubAddDraft> }): ReactNode {
  const mine = useStored(draft)
  useProposals(link, projectId, mine.github.host, (proposed) => {
    draft.set(proposalsArrived(draft.get(), proposed))
  })
  return (
    <GithubForm
      draft={mine.github}
      onChange={(github) => draft.set(githubEdited(draft.get(), github))}
      proposed={mine.proposed}
    />
  )
}

function GithubAddFoot({
  link,
  projectId,
  draft,
  close,
}: DialogProps & { draft: ProviderStore<GithubAddDraft>; close: () => void }): ReactNode {
  const mine = useStored(draft)
  return (
    <FormFoot
      refused={mine.refused}
      save="Add"
      saving={mine.saving}
      onSave={() => {
        const refusal = githubRefusal(mine.github)
        if (refusal !== undefined) {
          draft.set({ refused: refusal })
          return
        }
        draft.set({ saving: true, refused: undefined })
        link
          .addGithub(projectId, githubConfigOf(mine.github))
          .then(close, (failure: Error) => draft.set({ saving: false, refused: failure.message }))
      }}
      onCancel={close}
    />
  )
}

interface JiraAddProps extends DialogProps {
  store: ProviderStore<Read>
  draft: ProviderStore<JiraAddDraft>
  close: () => void
}

function JiraAddBody({ link, store, draft, projectId, close }: JiraAddProps): ReactNode {
  const mine = useStored(draft)
  const site = mine.jira.site.trim()
  // The site says whether it is Cloud or Data Center; the user confirms it with the tab.
  useEffect(() => {
    if (site === '') return undefined
    let current = true
    const timer = setTimeout(() => {
      link.jiraDeployment(site).then((deployment) => {
        const now = draft.get()
        if (current && deployment !== null && !now.chosen) {
          draft.set({ jira: { ...now.jira, deployment } })
        }
      }, nothing)
    }, TYPING_SETTLES_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [link, site, draft])
  // The token can only be kept for a provider that exists: giving it adds the provider first.
  const addWithToken = (token: string): void => {
    submitJira(link, store, draft, projectId, token).then((done) => {
      if (done) close()
    })
  }
  return (
    <JiraForm
      draft={mine.jira}
      onChange={(jira) =>
        draft.set({ jira, chosen: mine.chosen || jira.deployment !== mine.jira.deployment })
      }
      token={
        <TokenField
          status="missing"
          deployment={mine.jira.deployment}
          saving={mine.saving}
          refused={mine.tokenRefused}
          onSave={addWithToken}
          onFilled={(filled) => draft.set({ filled })}
          onRemove={nothing}
        />
      }
    />
  )
}

function JiraAddFoot({ link, projectId, store, draft, close }: JiraAddProps): ReactNode {
  const mine = useStored(draft)
  return (
    <FormFoot
      refused={mine.refused}
      save="Add"
      saving={mine.saving}
      // A token typed goes through the field's own Save; the foot adds a provider without one.
      saveDisabled={mine.filled}
      onSave={() => {
        submitJira(link, store, draft, projectId, null).then((done) => {
          if (done) close()
        })
      }}
      onCancel={close}
    />
  )
}

/** The ticket providers of a Project, in its settings. */
export function ProvidersPart({
  link,
  engineReady,
  projectId,
  show,
  copy,
}: ProvidersPartProps): ReactNode {
  const store = useProviderStore(link, engineReady, projectId)
  const state = useStored(store)
  const views: ReadonlyArray<ProviderView> | null = providerViewsOf(state, new Date())
  // A dialog left open over a section that is no longer shown closes with it.
  useEffect(() => () => show(null), [show])

  const close = (): void => show(null)
  const openProvider = (id: string): void => {
    const info = store.get().infos?.find((one) => one.id === id)
    const view = views?.find((one) => one.id === id)
    if (info === undefined || view === undefined) return
    const draft = providerStore<ProviderDraft>({
      github: { host: info.host, repositories: info.repositories },
      proposed: [],
      checking: false,
      saving: false,
      tokenSaving: false,
      tokenRefused: undefined,
      refused: undefined,
    })
    show({
      title: providerTitle(view),
      icon: <ProviderMark kind={view.kind} />,
      body: (
        <ProviderBody
          link={link}
          projectId={projectId}
          store={store}
          draft={draft}
          id={id}
          copy={copy}
        />
      ),
      footer: <ProviderFoot link={link} store={store} draft={draft} id={id} close={close} />,
    })
  }
  const addGithub = (): void => {
    const draft = providerStore<GithubAddDraft>({
      github: { host: 'github.com', repositories: [] },
      proposed: [],
      preselected: false,
      touched: false,
      saving: false,
      refused: undefined,
    })
    show({
      title: 'Add GitHub',
      icon: <ProviderMark kind="github" />,
      body: <GithubAddBody link={link} projectId={projectId} draft={draft} />,
      footer: <GithubAddFoot link={link} projectId={projectId} draft={draft} close={close} />,
    })
  }
  const addJira = (): void => {
    const draft = providerStore<JiraAddDraft>({
      jira: { site: '', deployment: 'cloud', email: '', projectKeys: '' },
      chosen: false,
      added: null,
      filled: false,
      saving: false,
      tokenRefused: undefined,
      refused: undefined,
    })
    show({
      title: 'Add Jira',
      icon: <ProviderMark kind="jira" />,
      body: (
        <JiraAddBody link={link} projectId={projectId} store={store} draft={draft} close={close} />
      ),
      footer: (
        <JiraAddFoot link={link} projectId={projectId} store={store} draft={draft} close={close} />
      ),
    })
  }
  return (
    <TicketProviders
      providers={views}
      error={state.error}
      onOpen={openProvider}
      onAdd={(kind) => (kind === 'github' ? addGithub() : addJira())}
    />
  )
}
