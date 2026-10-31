import { useState } from "react"
import { useAtomRefresh } from "@effect/atom-react"
import { ChatState, Composer, SessionTasks, type ChatSession } from "@ren/chat"
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
import { pickModel } from "../../components/model-picker.js"
import { useMe } from "../../lib/use-me.js"
import { useMembers } from "../../lib/use-members.js"
import { useSpaces } from "../../lib/use-spaces.js"
import { errorMessage } from "../../lib/errors.js"
import { useComposerSuggestions } from "./use-composer-suggestions.js"
import { childTitle, useView } from "./chat-view.js"
import { Seed } from "../../lib/seed.js"
import { sessionKeys, useChatCacheBridge } from "../../lib/chat.js"
import { sessionTitle } from "../../lib/sessions.js"
import { useAttentionNotification } from "../../lib/notify.js"
import { ChatPreferences } from "../../lib/chat-preferences.js"
import { Drafts } from "../../lib/drafts.js"
import { RouterContext } from "../../lib/router-context.js"

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

function useChatSuggestions(input: {
  root: Session.ID
  capabilities: SessionInfo["capabilities"] | undefined
  messages: ReadonlyArray<SessionMessage.Info>
  reverted: boolean
  model: SessionModel.Ref | undefined
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
  const suggestions = useComposerSuggestions({
    root: input.root,
    commands: input.capabilities?.commands !== false,
    client: {
      "model.choose": false,
      "session.compact": input.capabilities?.compact !== false && lastUser !== undefined,
      "session.undo": revertable && lastUser !== undefined,
      "session.redo": revertable && input.reverted,
    },
    onClient: (id) => {
      if (id === "session.compact") void compact(input.model).catch(fail("Could not compact the chat"))
      if (id === "session.undo" && lastUser) void revert(lastUser.id).catch(fail("Could not undo"))
      if (id === "session.redo") void redo().catch(fail("Could not restore messages"))
    },
  })
  return {
    suggest: suggestions.suggest,
    run: (
      request: ChatSession.PromptInput & { text: string },
      prompt: (request: ChatSession.PromptInput) => Promise<unknown>,
    ) => {
      const slash = suggestions.slash(request.text)
      const selection = {
        ...(request.delivery && { delivery: request.delivery }),
        ...(request.model && { model: request.model }),
      }
      return slash
        ? command({ name: slash.name, ...suggestions.resolve(slash.text), ...selection })
        : prompt({ ...request, ...suggestions.resolve(request.text) })
    },
  }
}

function bootStatusOf(
  connection: string | undefined,
  boot: PromptInputBoot | { readonly _tag: "Ready" } | undefined,
): PromptInputBoot | undefined {
  if (connection === "reconnecting") return { _tag: "Reconnecting" }
  if (boot && boot._tag !== "Ready") return boot
  return
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
  canRevert: info?.capabilities.revert !== false,
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
  const spaceName = useSpaces().spaceName(stored.data?.spaceId)
  const members = useMembers().members
  const models = ChatReact.useModels(root)
  const modelList = AsyncResult.isSuccess(models) ? models.value : []
  const [saved, setSaved] = useState(() => ChatPreferences.model.read(platform.storage))
  const kept = Drafts.useDraft(Drafts.session(root))
  const draft = kept.draft
  const setDraft = kept.set
  const [reverting, setReverting] = useState(false)
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
  const interrupt = ChatReact.useAction(root, (opened) => opened.interrupt)
  const loadMore = ChatReact.useAction(root, (opened) => opened.loadMore(view.viewed))
  const revert = ChatReact.useAction(root, (opened, id: SessionMessage.ID) => opened.revert(id))
  const redo = ChatReact.useAction(root, (opened) => opened.redo)
  const undo = ChatReact.useAction(root, (opened) => opened.undo)
  const compact = ChatReact.useAction(root, (opened) => opened.compact(info?.model))
  const reopen = useAtomRefresh(ChatReact.useAtoms().session(root))
  const restart = useMutation(api.chat.retry.mutationOptions())
  const archive = useMutation(api.session.archive.mutationOptions())
  const reverted = ChatState.revertMessageID(state, root) !== undefined
  const tasks = SessionTasks.latest(ChatState.messages(state, root))

  const expanded = ChatPreferences.detail.read(platform.storage) === "detailed"
  const blocked = Boolean(view.permission ?? view.form)
  useAttentionNotification({ running, asking: blocked, title })
  useChatCacheBridge(root, bridgeOf(info, { running }))

  const model = pickModel(modelList, [saved, info?.model])
  const suggestions = useChatSuggestions({
    root,
    capabilities: info?.capabilities,
    messages: view.messages,
    reverted,
    model,
  })
  const bootStatus = bootStatusOf(connection, boot)
  return {
    root,
    child,
    title,
    spaceId: stored.data?.spaceId,
    spaceName,
    viewer: viewerOf(me.user),
    expanded,
    bootStatus,
    blocked,
    view: { root, sessionID: view.viewed },
    messages: view.messages,
    rows: view.rows,
    activeMessageID: view.projection?.activeMessageID,
    busy: view.running,
    working: view.working,
    statuses: statusesOf(state, view.viewed),
    people: new Map(members.map((member) => [member.id, { name: member.name, image: member.image }])),
    modelNames: new Map(modelList.map((each) => [each.id, each.name])),
    more: ChatState.more(state, view.viewed),
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
    reverted,
    reverting,
    failed: AsyncResult.isFailure(view.session.state),
    boot,
    reconnecting: connection === "reconnecting",
    retrying: restart.isPending,
    draft,
    setDraft,
    suggest: suggestions.suggest,
    models: modelList,
    modelsLoading: AsyncResult.isInitial(models),
    model,
    ...capabilitiesOf(info),
    chooseModel: (next: SessionModel.Ref) => {
      ChatPreferences.model.write(platform.storage, next)
      setSaved(next)
    },
    send: () => {
      const text = Composer.message(draft).trim()
      if (!text) return
      const id = Composer.retryID(draft) ?? SessionMessage.ID.create()
      const sent = draft
      void platform.requestNotifications?.()
      setDraft(Composer.empty)
      const followUp = ChatPreferences.followUp.read(platform.storage)
      const selection = { delivery: running ? followUp : ("steer" as const), ...(model && { model }) }
      void suggestions.run({ id, text, ...selection }, prompt).catch((error: unknown) => {
        kept.update((current) => Composer.restore(current, sent, id))
        toast.error("Could not send your message", { description: `${errorMessage(error)} Your draft has been kept.` })
      })
    },
    resend: (text: string) =>
      void prompt({ id: SessionMessage.ID.create(), text, delivery: "steer", ...(model && { model }) }).catch(
        (error: unknown) => toast.error("Could not send your message", { description: errorMessage(error) }),
      ),
    stop: () =>
      void interrupt().catch((error: unknown) =>
        toast.error("Could not stop Ren", { description: errorMessage(error) }),
      ),
    loadMore: () =>
      void loadMore().catch((error: unknown) =>
        toast.error("Could not load earlier messages", { description: errorMessage(error) }),
      ),
    edit: (message: SessionMessage.User, text: string) => {
      setReverting(true)
      void revert(message.id)
        .then(() => prompt({ id: SessionMessage.ID.create(), text, delivery: "steer", ...(model && { model }) }))
        .catch((error: unknown) => toast.error("Could not edit your message", { description: errorMessage(error) }))
        .finally(() => setReverting(false))
    },
    prompted: ChatState.visibleUserMessages(state, root).length > 0,
    undo: () =>
      void undo().then(
        (message) => {
          if (Option.isSome(message))
            kept.update((current) => Composer.fromHistory(current, { text: message.value.text, pasted: [] }))
        },
        (error: unknown) => toast.error("Could not undo the last message", { description: errorMessage(error) }),
      ),
    compact: () =>
      void compact().catch((error: unknown) =>
        toast.error("Could not compact the chat", { description: errorMessage(error) }),
      ),
    restore: () =>
      void redo().catch((error: unknown) =>
        toast.error("Could not restore messages", { description: errorMessage(error) }),
      ),
    retry: () =>
      restart.mutate(
        { id: root },
        {
          onSuccess: () => reopen(),
          onError: (error) => toast.error("Could not start this chat again", { description: errorMessage(error) }),
        },
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
