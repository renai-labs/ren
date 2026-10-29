import { useState } from "react"
import { useAtomRefresh } from "@effect/atom-react"
import { ChatState, Composer, Family, SessionTasks, Working, type ChatSession, type TimelineRow } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import type { SessionInfo } from "@ren/client"
import { useMutation, useQuery } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Effect, SubscriptionRef } from "effect"
import { AsyncResult } from "effect/reactivity"
import { toast } from "sonner"
import type { PromptInputBoot } from "@/components/ren/chat/prompt-input"
import { pickModel } from "@/components/ren/model-picker"
import { useMe } from "@/hooks/use-me"
import { useMembers } from "@/hooks/use-members"
import { useSpaces } from "@/hooks/use-spaces"
import { api, errorMessage } from "@/lib/api"
import { useComposerSuggestions } from "@/routes/chat/use-composer-suggestions"
import { seedFromLists } from "@/lib/cache"
import { sessionKeys, useChatCacheBridge } from "@/lib/chat"
import { sessionTitle } from "@/lib/sessions"
import { askToNotify, useAttentionNotification } from "@/lib/notify"
import { chooseModel, useChatDetail, useChosenModel, useFollowUp } from "@/stores/ui"

const route = getRouteApi("/_authed/_shell/sessions/$sessionId")

const noRows: ReadonlyArray<TimelineRow.Row> = []

const childTitle = (state: ChatState.State, sessionID: string) =>
  sessionTitle(Family.childTitle(state, sessionID, ""), "Subagent")

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

function useView(root: Session.ID, child: Session.ID | undefined) {
  const session = ChatReact.useSession(root)
  const childResult = ChatReact.useChild(root, child ?? root)
  const state = AsyncResult.getOrElse(session.state, () => ChatState.empty)
  const viewed = child ?? root
  const projection = child
    ? AsyncResult.isSuccess(childResult)
      ? childResult.value
      : undefined
    : AsyncResult.isSuccess(session.timeline)
      ? session.timeline.value
      : undefined
  const permission = Family.permission(state, viewed)
  const form = Family.form(state, viewed)
  return {
    session,
    state,
    viewed,
    projection,
    messages: ChatState.messages(state, viewed),
    rows: projection?.rows ?? noRows,
    running: ChatState.activity(state, viewed) === "running",
    working: projection
      ? Working.show(state, viewed, projection, child ? (state.info[viewed]?.parentID ?? root) : viewed)
      : false,
    permission,
    permissionTitle: permission ? childTitle(state, permission.sessionID) : "",
    form,
    formTitle: form ? childTitle(state, form.sessionID) : "",
    formExpired: form ? Family.isExpired(state, form) : false,
  }
}

export function useChatPage() {
  const params = route.useParams()
  const search = route.useSearch()
  const navigate = useNavigate()
  return useChat(params.sessionId, {
    child: search.child,
    onChild: (id) =>
      void navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: params.sessionId },
        search: id ? { child: id } : {},
      }),
    onArchived: () => void navigate({ to: "/" }),
  })
}

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

const bootStatusOf = (
  connection: string | undefined,
  boot: PromptInputBoot | { readonly _tag: "Ready" } | undefined,
): PromptInputBoot | undefined =>
  connection === "reconnecting" ? { _tag: "Reconnecting" } : boot && boot._tag !== "Ready" ? boot : undefined

export function useChat(
  sessionId: string,
  options: {
    readonly child?: string | undefined
    readonly onChild?: ((id: Session.ID | undefined) => void) | undefined
    readonly onArchived?: (() => void) | undefined
  },
) {
  const params = { sessionId }
  const me = useMe()
  const root = Session.ID.make(params.sessionId)
  const [localChild, setLocalChild] = useState<Session.ID>()
  const child = options.onChild ? (options.child ? Session.ID.make(options.child) : undefined) : localChild
  const stored = useQuery({
    ...api.session.get.queryOptions({ idOrSlug: params.sessionId }),
    ...seedFromLists<SessionInfo>([api.session.list.queryKey(), sessionKeys.infinite()], params.sessionId),
  })
  const view = useView(root, child)
  const state = view.state
  const info = state.info[root]
  const running = ChatState.activity(state, root) === "running"
  const title = sessionTitle(info?.title ?? stored.data?.title)
  const spaceName = useSpaces().spaceName(stored.data?.spaceId)
  const members = useMembers().members
  const followUp = useFollowUp()
  const models = ChatReact.useModels(root)
  const modelList = AsyncResult.isSuccess(models) ? models.value : []
  const saved = useChosenModel()
  const [draft, setDraft] = useState<Composer.Draft>(Composer.empty)
  const [reverting, setReverting] = useState(false)
  const boot = AsyncResult.isSuccess(view.session.boot) ? view.session.boot.value : undefined
  const connection = AsyncResult.isSuccess(view.session.status) ? view.session.status.value : undefined
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
  const reopen = useAtomRefresh(ChatReact.useAtoms().session(root))
  const restart = useMutation(api.chat.retry.mutationOptions())
  const archive = useMutation(api.session.archive.mutationOptions())
  const reverted = ChatState.revertMessageID(state, root) !== undefined
  const tasks = SessionTasks.latest(ChatState.messages(state, root))

  const expanded = useChatDetail() === "detailed"
  useAttentionNotification({ running, asking: Boolean(view.permission ?? view.form), title })
  useChatCacheBridge(root, {
    ...(info && { title: sessionTitle(info.title, "") || undefined, status: running ? "busy" : "idle" }),
  })

  const model = pickModel(modelList, [saved, info?.model])
  const suggestions = useChatSuggestions({
    root,
    capabilities: info?.capabilities,
    messages: view.messages,
    reverted,
    model,
  })
  const name = me.user.name || me.user.email
  const bootStatus = bootStatusOf(connection, boot)
  return {
    root,
    child,
    title,
    spaceId: stored.data?.spaceId,
    spaceName,
    viewer: { id: me.user.id, name, image: me.user.image ?? undefined },
    expanded,
    bootStatus,
    blocked: Boolean(view.permission ?? view.form),
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
    childTitle: child ? childTitle(state, child) : undefined,
    requests: {
      permission: view.permission,
      permissionTitle: view.permissionTitle,
      form: view.form,
      formTitle: view.formTitle,
      formExpired: view.formExpired,
    },
    tasks: tasks.length > 0 && (running || SessionTasks.unfinished(tasks)) ? tasks : [],
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
    modelsLoading: !AsyncResult.isSuccess(models) && !AsyncResult.isFailure(models),
    model,
    canChooseModel: info?.capabilities.model !== false,
    canRevert: info?.capabilities.revert !== false,
    chooseModel: (next: SessionModel.Ref) => chooseModel(next),
    send: () => {
      const text = Composer.message(draft).trim()
      if (!text) return
      const id = SessionMessage.ID.create()
      const sent = draft
      askToNotify()
      setDraft(Composer.empty)
      const selection = { delivery: running ? followUp : ("steer" as const), ...(model && { model }) }
      void suggestions.run({ id, text, ...selection }, prompt).catch((error: unknown) => {
        setDraft(sent)
        toast.error("Could not send your message", { description: `${errorMessage(error)} Your draft has been kept.` })
      })
    },
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
