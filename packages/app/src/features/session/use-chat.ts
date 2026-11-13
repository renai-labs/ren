import { useState } from "react"
import { useAtomRefresh } from "@effect/atom-react"
import { ChatState, ClientCommand, Composer, SessionTasks, type ChatSession, type Family } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import type { SessionInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Effect, Option, SubscriptionRef } from "effect"
import { AsyncResult } from "effect/reactivity"
import { toast } from "@ren/ui/sonner"
import type { PromptInputBoot } from "./prompt-input.js"
import { quoteOf } from "./use-chat-quote.js"
import { pickModel } from "../../components/model-picker.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { useModels } from "../../lib/use-models.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { errorMessage } from "../../lib/errors.js"
import { useComposerSuggestions } from "./use-composer-suggestions.js"
import { childTitle, notificationsOf, useView } from "./chat-view.js"
import { Seed } from "../../lib/seed.js"
import { sessionKeys, useChatCacheBridge } from "../../lib/chat.js"
import { sessionTitle } from "../../lib/sessions.js"
import { Notify } from "../../lib/notify.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Drafts } from "../../lib/drafts.js"
import { RouterContext } from "../../lib/router-context.js"
import { Keyboard } from "../../platform/keyboard.js"
import { useShellHistory } from "../../lib/use-shell-history.js"

const statusesOf = (state: ChatState.State, sessionID: Session.ID): ReadonlyMap<string, ChatState.PendingStatus> =>
  new Map(
    ChatState.pending(state, sessionID).flatMap((item) => {
      const status = item.type === "user" ? ChatState.pendingStatus(state, sessionID, item.id) : undefined
      return status ? [[item.id, status] as const] : []
    }),
  )

const known = (state: ChatState.State, sessionID: Session.ID, id: SessionMessage.ID) =>
  ChatState.messages(state, sessionID).some((message) => message.id === id) ||
  ChatState.pending(state, sessionID).some((item) => item.id === id)

export interface WorkspaceCommands {
  readonly openTerminal: () => void
  readonly openFile: (path: string) => void
}

function useChatSuggestions(input: {
  root: Session.ID
  capabilities: SessionInfo["capabilities"] | undefined
  messages: ReadonlyArray<SessionMessage.Info>
  reverted: boolean
  model: SessionModel.Ref | undefined
  spaceId: string | undefined
  mentions: ReadonlyArray<Composer.MentionedApp>
  canChooseModel: boolean
  onChooseModel: () => void
  workspace: WorkspaceCommands | undefined
  onRename: (() => void) | undefined
  onNew: ((spaceId: string | undefined) => void) | undefined
  rename: (title: string) => Promise<unknown>
  apps: () => void
}) {
  const compact = ChatReact.useAction(input.root, (opened, next: SessionModel.Ref | undefined) => opened.compact(next))
  const revert = ChatReact.useAction(input.root, (opened, id: SessionMessage.ID) => opened.revert(id))
  const redo = ChatReact.useAction(input.root, (opened) => opened.redo)
  const lastUser = input.messages.findLast((message) => message.type === "user")
  const revertable = input.capabilities?.revert !== false
  const fail = (title: string) => (error: unknown) => toast.error(title, { description: errorMessage(error) })
  const command = ChatReact.useAction(input.root, (opened, request: ChatSession.CommandInput) =>
    opened.command(request),
  )
  const actions: Record<ClientCommand.ID, (text: string) => void> = {
    "model.choose": () => input.onChooseModel(),
    "session.compact": () => void compact(input.model).catch(fail("Could not compact the chat")),
    "session.undo": () => lastUser && void revert(lastUser.id).catch(fail("Could not undo")),
    "session.redo": () => void redo().catch(fail("Could not restore messages")),
    "session.new": () => input.onNew?.(input.spaceId),
    "panel.terminal": () => input.workspace?.openTerminal(),
    "file.open": (text) => input.workspace?.openFile(text),
    "session.rename": (text) => (text ? void input.rename(text) : input.onRename?.()),
    "apps.open": () => input.apps(),
  }
  const runClient = (id: ClientCommand.ID, text: string) => actions[id](text)
  const suggestions = useComposerSuggestions({
    root: input.root,
    spaceId: input.spaceId,
    mentions: input.mentions,
    commands: input.capabilities?.commands !== false,
    client: {
      "model.choose": input.canChooseModel,
      "session.compact": input.capabilities?.compact !== false && lastUser !== undefined,
      "session.undo": revertable && lastUser !== undefined,
      "session.redo": revertable && input.reverted,
      "session.new": input.onNew !== undefined,
      "panel.terminal": input.workspace !== undefined,
      "file.open": input.workspace !== undefined,
      "session.rename": input.onRename !== undefined && input.capabilities?.rename !== false,
      "apps.open": input.spaceId !== undefined,
    },
    onClient: runClient,
  })
  return {
    suggest: suggestions.suggest,
    run: (
      request: ChatSession.PromptInput & { text: string },
      prompt: (request: ChatSession.PromptInput) => Promise<unknown>,
    ) => {
      const client = request.presentation ? undefined : suggestions.client(request.text)
      if (client) return Promise.resolve(runClient(client.id, client.input))
      const slash = request.presentation ? undefined : suggestions.slash(request.text)
      const selection = {
        ...(request.delivery && { delivery: request.delivery }),
        ...(request.model && { model: request.model }),
      }
      if (slash) return command({ name: slash.name, ...suggestions.resolve(slash.text), ...selection })
      const presentation = request.presentation
      const resolved = suggestions.resolve(presentation?.displayText ?? request.text)
      return prompt({
        ...request,
        ...resolved,
        text: presentation
          ? [resolved.text, ...presentation.comments.map(Composer.formatQuoteComment)].filter(Boolean).join("\n")
          : resolved.text,
        ...(presentation && { presentation: { displayText: resolved.text, comments: presentation.comments } }),
      })
    },
  }
}

function bootStatusOf(
  connection: { readonly status: string | undefined; readonly retryAt: number },
  boot: PromptInputBoot | { readonly _tag: "Ready" } | undefined,
): PromptInputBoot | undefined {
  if (boot && boot._tag !== "Ready") return boot
  if (connection.status !== "reconnecting") return
  return connection.retryAt - Date.now() >= 2_000
    ? { _tag: "Waiting", retryAt: connection.retryAt }
    : { _tag: "Reconnecting" }
}

const childOf = (
  options: { readonly child?: string | undefined; readonly onChild?: unknown },
  local: Session.ID | undefined,
) => {
  if (!options.onChild) return local
  return options.child ? Session.ID.make(options.child) : undefined
}

const capabilitiesOf = (info: { readonly capabilities: SessionInfo["capabilities"] } | undefined) => ({
  capabilities: info?.capabilities,
  canChooseModel: info?.capabilities.model !== false,
  canQueue: info?.capabilities.queue !== false,
  canRevert: info?.capabilities.revert !== false,
  canRename: info?.capabilities.rename !== false,
  canCompact: info?.capabilities.compact !== false,
  canReadFiles: info?.capabilities.files === true,
})

const bridgeOf = (
  info: { readonly title?: string | null | undefined } | undefined,
  state: { readonly running: boolean },
) =>
  info
    ? {
        title: sessionTitle(info.title, "") || undefined,
        status: state.running ? ("busy" as const) : ("idle" as const),
      }
    : {}

const viewerOf = (user: {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly image?: string | null | undefined
}) => ({
  id: user.id,
  name: user.name || user.email,
  image: user.image ?? undefined,
})

function useBackgroundWork(root: Session.ID, child: Session.ID | undefined, activity: ReadonlyArray<Family.Activity>) {
  const background = ChatReact.useAction(root, (opened) => opened.background)
  const blocking = activity.some((item) => item.blocking)
  const move = () =>
    void background().catch((error: unknown) =>
      toast.error("Could not move the work to the background", { description: errorMessage(error) }),
    )
  Keyboard.useKeyDown((event) => {
    if (child || !blocking || event.key !== "b" || !event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    move()
  })
  if (child) return
  return { blocking, onMove: move }
}

const visibleTasks = <A>(
  tasks: ReadonlyArray<A>,
  state: { readonly running: boolean; readonly unfinished: boolean },
) => (tasks.length > 0 && (state.running || state.unfinished) ? tasks : [])

export function useChat(
  sessionId: string,
  options: {
    readonly child?: string | undefined
    readonly onChild?: ((id: Session.ID | undefined) => void) | undefined
    readonly onArchived?: (() => void) | undefined
    readonly workspace?: WorkspaceCommands | undefined
    readonly onRename?: (() => void) | undefined
    readonly onNew?: ((spaceId: string | undefined) => void) | undefined
  },
) {
  const { api, platform, queryClient } = RouterContext.useRouterContext()
  const params = { sessionId }
  const me = useMe()
  const root = Session.ID.make(params.sessionId)
  const [localChild, setLocalChild] = useState<Session.ID>()
  const child = childOf(options, localChild)
  const stored = useQuery({
    ...api.session.get.queryOptions({ idOrSlug: params.sessionId }),
    ...Seed.fromList<SessionInfo>(queryClient, [api.session.list.queryKey(), sessionKeys.infinite()], params.sessionId),
  })
  const view = useView(root, child)
  const state = view.state
  const info = state.info[root]
  const running = ChatState.activity(state, root) === "running"
  const title = sessionTitle(info?.title ?? stored.data?.title)
  const spaceId = stored.data?.spaceId
  const spaceName = useSpaces().spaceName(spaceId)
  const members = useMembers().members
  const models = ChatReact.useModels(root)
  const catalog = useModels(root)
  const modelList = AsyncResult.isSuccess(models) ? models.value : catalog.models
  const [saved, setSaved] = useState(() => ChatPreferences.model.read(platform.storage))
  const kept = Drafts.useDraft(Drafts.session(root))
  const draft = kept.draft
  const history = Drafts.useHistory()
  const setDraft = kept.set
  const [reverting, setReverting] = useState(false)
  const [picking, setPicking] = useState(false)
  const abilities = capabilitiesOf(info)
  const boot = AsyncResult.getOrElse(view.session.boot, () => undefined)
  const connection = AsyncResult.getOrElse(view.session.status, () => undefined)
  const prompt = ChatReact.useAction(root, (opened, request: ChatSession.PromptInput) =>
    opened.prompt(request).pipe(
      Effect.retry({ times: 1 }),
      Effect.catch((error) =>
        Effect.flatMap(SubscriptionRef.get(opened.state), (current) =>
          request.id && known(current, root, request.id) ? Effect.void : Effect.fail(error),
        ),
      ),
    ),
  )
  const runShell = ChatReact.useAction(root, (opened, command: string) => opened.runShell(command))
  const shellHistory = useShellHistory()
  const retryMessage = ChatReact.useAction(root, (opened, id: SessionMessage.ID) => opened.retryMessage(id))
  const removeMessage = ChatReact.useAction(root, (opened, id: SessionMessage.ID) => opened.removeMessage(id))
  const interrupt = ChatReact.useAction(root, (opened) => opened.interrupt)
  const retryNow = ChatReact.useAction(root, (opened) => opened.retryNow)
  const cancelQueued = ChatReact.useAction(root, (opened, id: SessionMessage.ID) => opened.cancelInput(id))
  const steerQueued = ChatReact.useAction(root, (opened, id: SessionMessage.ID) => opened.steerInput(id))
  const loadMore = ChatReact.useAction(root, (opened) => opened.loadMore(view.viewed))
  const loadAll = ChatReact.useAction(root, (opened) => opened.loadMore(view.viewed, true))
  const revert = ChatReact.useAction(root, (opened, id: SessionMessage.ID) => opened.revert(id))
  const redo = ChatReact.useAction(root, (opened) => opened.redo)
  const undo = ChatReact.useAction(root, (opened) => opened.undo)
  const renameAction = ChatReact.useAction(root, (opened, next: string) => opened.rename(next))
  const rename = (next: string) =>
    renameAction(next).catch((error: unknown) => {
      toast.error("Couldn’t rename the chat", { description: errorMessage(error) })
    })
  const [appsOpen, setAppsOpen] = useState(false)
  const compact = ChatReact.useAction(root, (opened, next: SessionModel.Ref | undefined) => opened.compact(next))
  const reopen = useAtomRefresh(ChatReact.useAtoms().session(root))
  const restart = ChatReact.useAction(root, (opened) => opened.retry)
  const archive = useMutation(api.session.archive.mutationOptions())
  const backgroundWork = useBackgroundWork(root, child, view.activity)
  const reverted = ChatState.revertMessageID(state, root) !== undefined
  const tasks = SessionTasks.latest(ChatState.messages(state, root))

  const expanded = ChatPreferences.detail.read(platform.storage) === "detailed"
  const blocked = Boolean(view.permission ?? view.form)
  Notify.useChatNotifications({ root, title, running, ...notificationsOf(state, root) })
  useChatCacheBridge(root, bridgeOf(info, { running }))

  const model = pickModel(modelList, [saved, info?.model])
  const suggestions = useChatSuggestions({
    root,
    capabilities: info?.capabilities,
    messages: view.messages,
    reverted,
    model,
    spaceId,
    mentions: Composer.mentions(draft),
    canChooseModel: abilities.canChooseModel,
    onChooseModel: () => setPicking(true),
    workspace: options.workspace,
    onRename: options.onRename,
    onNew: options.onNew,
    rename,
    apps: () => setAppsOpen(true),
  })
  const bootStatus = bootStatusOf(
    { status: connection, retryAt: AsyncResult.getOrElse(view.session.retryAt, () => 0) },
    boot,
  )
  return {
    root,
    child,
    title,
    spaceId,
    spaceName,
    viewer: viewerOf(me.user),
    expanded,
    bootStatus,
    blocked,
    view: { root, sessionID: view.viewed },
    messages: view.messages,
    contextUsage: view.contextUsage,
    rows: view.rows,
    activeMessageID: view.projection?.activeMessageID,
    busy: view.running,
    activity: view.activity,
    background: backgroundWork,
    backgroundActivity: ChatPreferences.backgroundActivity.read(platform.storage),
    working: view.working,
    statuses: statusesOf(state, view.viewed),
    people: new Map(members.map((member) => [member.id, { name: member.name, image: member.image }])),
    modelNames: new Map(modelList.map((each) => [each.id, each.name])),
    more: ChatState.more(state, view.viewed),
    loading: view.loading,
    loadingHistory: ChatState.loadingHistory(state, view.viewed),
    childTitle: child && childTitle(state, child),
    requests: {
      permission: view.permission,
      permissionTitle: view.permissionTitle,
      form: view.form,
      formTitle: view.formTitle,
      formExpired: view.formExpired,
    },
    tasks: visibleTasks(tasks, { running, unfinished: SessionTasks.unfinished(tasks) }),
    running,
    queued: Composer.queued(ChatState.pending(state, root)),
    removeQueued: (id: SessionMessage.ID) =>
      void cancelQueued(id).catch((error: unknown) =>
        toast.error("Could not remove the message", { description: errorMessage(error) }),
      ),
    sendQueuedNow: (id: SessionMessage.ID) =>
      void steerQueued(id).catch((error: unknown) =>
        toast.error("Could not send the message now", { description: errorMessage(error) }),
      ),
    reverted,
    reverting,
    failed: AsyncResult.isFailure(view.session.state),
    boot,
    draft,
    setDraft,
    files: { sessionId: root, spaceId, update: kept.update },
    suggest: suggestions.suggest,
    models: modelList,
    modelsLoading: AsyncResult.isInitial(models) && catalog.loading,
    model,
    ...abilities,
    picking,
    setPicking,
    chooseModel: (next: SessionModel.Ref) => {
      ChatPreferences.model.write(platform.storage, next)
      setSaved(next)
    },
    quote: quoteOf({
      child,
      blocked,
      draft,
      canQueue: abilities.canQueue,
      running,
      followUp: ChatPreferences.followUp.read(platform.storage),
      model,
      update: kept.update,
      send: (request) => suggestions.run(request, prompt),
    }),
    shellHistory,
    send: (options: { readonly alternative: boolean }) => {
      if (Composer.isShell(draft)) {
        const command = Composer.message(draft).trim()
        if (!command) return
        const sent = draft
        shellHistory.add(command)
        setDraft(Composer.emptyShell)
        void runShell(command).catch((error: unknown) => {
          kept.update((current) => (Composer.isBlank(current) ? sent : current))
          toast.error("Couldn’t run the command", { description: errorMessage(error) })
        })
        return
      }
      const request = Composer.request(draft)
      const text = request.text.trim()
      if (!text) return
      const id = Composer.messageID(draft) ?? SessionMessage.ID.create()
      const submission = Composer.submission(draft, {
        working: running,
        behavior: ChatPreferences.followUp.read(platform.storage),
        alternative: options.alternative,
        queue: abilities.canQueue,
        current: model,
      })
      if (!submission) return
      void platform.requestNotifications?.()
      history.prepend(submission.sent)
      setDraft(submission.next)
      const selection = { delivery: submission.delivery, ...(model && { model }) }
      void suggestions
        .run({ ...request, id, text, ...selection, files: Composer.files(draft) }, prompt)
        .catch((error: unknown) => {
          history.remove(submission.sent)
          kept.update((current) => Composer.restore(current, submission.sent, id))
          toast.error("Could not send your message", {
            description: `${errorMessage(error)} Your draft has been kept.`,
          })
        })
    },
    connected: (app: string) =>
      void prompt({
        id: SessionMessage.ID.create(),
        text: `I connected ${app}.`,
        delivery: running ? ChatPreferences.followUp.read(platform.storage) : "steer",
        ...(model && { model }),
      }).catch((error: unknown) => toast.error("Could not send your message", { description: errorMessage(error) })),
    resend: (text: string) =>
      void prompt({ id: SessionMessage.ID.create(), text, delivery: "steer", ...(model && { model }) }).catch(
        (error: unknown) => toast.error("Could not send your message", { description: errorMessage(error) }),
      ),
    retryUnsent: (id: SessionMessage.ID) =>
      void retryMessage(id).catch((error: unknown) =>
        toast.error("Could not send your message", { description: errorMessage(error) }),
      ),
    removeUnsent: (id: SessionMessage.ID) =>
      void removeMessage(id).then(
        (item) => {
          if (!item) return
          kept.update((current) => {
            const next = Composer.recall(current, item)
            return item.files?.length && spaceId && !next.chat
              ? Composer.withChat(next, { sessionId: root, spaceId })
              : next
          })
        },
        (error: unknown) => toast.error("Could not remove your message", { description: errorMessage(error) }),
      ),
    stop: () =>
      void interrupt().catch((error: unknown) =>
        toast.error("Could not stop Ren", { description: errorMessage(error) }),
      ),
    loadMore: () =>
      void loadMore().catch((error: unknown) =>
        toast.error("Could not load earlier messages", { description: errorMessage(error) }),
      ),
    loadAll: () =>
      void loadAll().catch((error: unknown) =>
        toast.error("Could not load earlier messages", { description: errorMessage(error) }),
      ),
    edit: (message: SessionMessage.User, text: string) => {
      setReverting(true)
      const request = Composer.request({ ...Composer.fromMessage(message), text })
      void revert(message.id)
        .then(() => prompt({ id: SessionMessage.ID.create(), ...request, delivery: "steer", ...(model && { model }) }))
        .catch((error: unknown) => toast.error("Could not edit your message", { description: errorMessage(error) }))
        .finally(() => setReverting(false))
    },
    rename,
    apps: { open: appsOpen, onOpenChange: setAppsOpen },
    prompted: ChatState.visibleUserMessages(state, root).length > 0,
    undo: () =>
      void undo().then(
        (message) => {
          if (Option.isSome(message))
            kept.update((current) => Composer.fromHistory(current, Composer.fromMessage(message.value)))
        },
        (error: unknown) => toast.error("Could not undo the last message", { description: errorMessage(error) }),
      ),
    compact: () =>
      void compact(model).catch((error: unknown) =>
        toast.error("Could not compact the chat", { description: errorMessage(error) }),
      ),
    restore: () =>
      void redo().catch((error: unknown) =>
        toast.error("Could not restore messages", { description: errorMessage(error) }),
      ),
    reopen,
    retryNow: () => void retryNow(),
    retry: () =>
      void restart().catch((error: unknown) =>
        toast.error("Could not start this chat again", { description: errorMessage(error) }),
      ),
    openChild: (id: Session.ID | undefined) => (options.onChild ? options.onChild(id) : setLocalChild(id)),
    archive: () =>
      archive.mutateAsync(
        { id: root },
        {
          onSuccess: () => {
            toast.success("Chat archived")
            options.onArchived?.()
          },
        },
      ),
  }
}
