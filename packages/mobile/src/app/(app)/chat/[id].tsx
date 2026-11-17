import { useKeyboardChatComposerInset } from "@legendapp/list/keyboard"
import { useAtomRefresh } from "@effect/atom-react"
import { ChatState, Composer, SessionLive, SessionTitle } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import type { SessionCapabilities } from "@ren/schema/session/capabilities"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import type { SessionInfo } from "@ren/client"
import { Seed, SessionPages } from "@ren/client/react"
import { ErrorText } from "@ren/util/error-text"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AsyncResult } from "effect/reactivity"
import { useLocalSearchParams, useRouter } from "expo-router"
import { Drawer } from "expo-router/drawer"
import { useNetworkState } from "expo-network"
import { type ComponentRef, type Ref, useImperativeHandle, useRef, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import ArrowDownIcon from "react-native-heroicons/mini/ArrowDownIcon"
import { KeyboardStickyView } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { withUniwind } from "uniwind"
import { Appear } from "#components/appear"
import { Button } from "#components/button"
import { HeaderActions } from "#components/header-button"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import { ActivityPill } from "#features/chat/activity-pill"
import { useAttachments } from "#features/chat/attachments"
import { ChatActions } from "#features/chat/chat-actions"
import { ChatRequests } from "#features/chat/chat-requests"
import { useSessionModel } from "#features/chat/model-picker"
import { MentionedApps } from "#features/chat/app-connect"
import { useMentions } from "#features/chat/mentions"
import { PromptInput } from "#features/chat/prompt-input"
import { QueuedMessages } from "#features/chat/queued-messages"
import { Transcript, type TranscriptHandle } from "#features/chat/transcript"
import { Api } from "#lib/api"
import { Preferences } from "#lib/preferences"

const StickyView = withUniwind(KeyboardStickyView)

const dots = {
  offline: { label: "Offline", className: "bg-destructive" },
  reconnecting: { label: "Reconnecting", className: "bg-chart-3" },
  connecting: { label: "Connecting", className: "bg-chart-3" },
  working: { label: "Working", className: "bg-chart-2" },
} as const

function Header(props: {
  readonly title: string
  readonly space: string | undefined
  readonly status: keyof typeof dots | undefined
}) {
  const dot = props.status ? dots[props.status] : undefined
  return (
    <View className="max-w-60">
      <Text className="text-lg font-medium" numberOfLines={1}>
        {props.title}
      </Text>
      {props.space || dot ? (
        <View className="flex-row items-center gap-1.5">
          {dot ? <View role="img" aria-label={dot.label} className={`size-1.5 rounded-full ${dot.className}`} /> : null}
          <Text className="shrink text-xs text-muted-foreground" numberOfLines={1}>
            {props.space ?? ""}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

function ChatHeader(props: {
  readonly id: Session.ID
  readonly title: string | undefined
  readonly info: SessionInfo | undefined
  readonly connection: string
  readonly running: boolean
  readonly usage: ChatReact.ContextUsage | undefined
  readonly model: SessionModel.Ref | undefined
}) {
  const router = useRouter()
  const title = SessionTitle.display(props.title ?? props.info?.title)
  const offline = useNetworkState().isConnected === false
  const spaceId = props.info?.spaceId
  const space = useQuery({
    ...Api.query.space.get.queryOptions({ idOrSlug: spaceId ?? "" }),
    enabled: Boolean(spaceId),
  })
  const status = (
    [
      { when: offline, status: "offline" },
      { when: props.connection === "reconnecting", status: "reconnecting" },
      { when: props.connection === "connecting", status: "connecting" },
      { when: props.running, status: "working" },
    ] as const
  ).find((each) => each.when)?.status
  return (
    <Drawer.Screen
      options={{
        headerTitleAlign: "left",
        headerTitle: () => <Header title={title} space={space.data?.name} status={status} />,
        headerRight: () => (
          <HeaderActions>
            <ChatActions
              sessionId={props.id}
              title={title}
              capabilities={{
                rename: props.info?.capabilities.rename !== false,
                compact: props.info?.capabilities.compact !== false,
              }}
              usage={props.usage && { tokens: props.usage.tokens, percent: props.usage.percent }}
              model={props.model}
              onArchived={() => router.navigate("/")}
            />
          </HeaderActions>
        ),
      }}
    />
  )
}

export default function ChatRoute() {
  const id = Session.ID.make(useLocalSearchParams<{ id: string }>().id)
  return <Chat key={id} id={id} />
}

interface DraftHandle {
  readonly recall: (item: Parameters<typeof Composer.recall>[1]) => void
}

function ChatComposer(props: {
  readonly id: Session.ID
  readonly spaceId: string | undefined
  readonly running: boolean
  readonly capabilities: SessionCapabilities.Info | undefined
  readonly models: ReturnType<typeof useSessionModel>
  readonly handle: Ref<DraftHandle>
  readonly onSent: () => void
  readonly onError: (message: string) => void
  readonly onStop: () => void
}) {
  const prompt = ChatReact.usePrompt(props.id)
  const [draft, setDraft] = useState<Composer.Draft>(Composer.empty)
  const attachments = useAttachments({ sessionId: props.id, spaceId: props.spaceId, draft, update: setDraft })
  const mentions = useMentions({
    root: props.id,
    spaceId: props.spaceId,
    draft,
    update: setDraft,
    onError: props.onError,
  })
  const models = props.models
  useImperativeHandle(props.handle, (): DraftHandle => ({
    recall: (item) => setDraft((current) => Composer.recall(current, item)),
  }))
  const send = () => {
    const text = Composer.request(draft).text.trim()
    const submission = Composer.submission(draft, {
      working: props.running,
      behavior: "queue",
      alternative: false,
      queue: props.capabilities?.queue !== false,
      current: models.model,
    })
    if (!text || !submission) return
    const messageID = Composer.messageID(draft) ?? SessionMessage.ID.create()
    setDraft(submission.next)
    props.onSent()
    void mentions
      .prepare()
      .then(() =>
        prompt({
          id: messageID,
          delivery: submission.delivery,
          files: Composer.files(draft),
          ...mentions.resolve(text),
          ...models.selection,
        }),
      )
      .catch((cause: unknown) => {
        setDraft((current) => Composer.restore(current, submission.sent, messageID))
        props.onError(ErrorText.of(cause, "Couldn’t send your message. Your draft has been kept."))
      })
  }
  return (
    <>
      <MentionedApps spaceId={props.spaceId} apps={mentions.mentioned} />
      <PromptInput
        value={draft.text}
        onChange={mentions.change}
        onSend={send}
        onStop={props.onStop}
        running={props.running}
        attachments={attachments}
        suggest={mentions.suggestions}
        {...(props.spaceId && { space: { id: props.spaceId, onMentionApp: mentions.mention } })}
        {...(models.choosable && {
          model: { models: models.models, value: models.model, onChange: models.choose },
        })}
      />
    </>
  )
}

function Chat(props: { readonly id: Session.ID }) {
  const id = props.id
  const queryClient = useQueryClient()
  const info = useQuery({
    ...Api.query.session.get.queryOptions({ idOrSlug: id }),
    ...Seed.fromList<SessionInfo>(queryClient, [Api.query.session.list.queryKey(), SessionPages.keys.all()], id),
  }).data
  const [detail] = Preferences.usePreference(Preferences.timelineDetail)
  const [fold] = Preferences.usePreference(Preferences.foldTurns)
  const [foldMessages] = Preferences.usePreference(Preferences.foldMessages)
  const view = ChatReact.useView(id, undefined, detail)
  const models = useSessionModel(id, view.state.info[id])
  const reopen = useAtomRefresh(ChatReact.useAtoms().session(id))
  const loadMore = ChatReact.useAction(id, (opened) => opened.loadMore(id))
  const prompt = ChatReact.usePrompt(id)
  const draftRef = useRef<DraftHandle>(null)
  const interrupt = ChatReact.useAction(id, (opened) => opened.interrupt)
  const retryMessage = ChatReact.useAction(id, (opened, message: SessionMessage.ID) => opened.retryMessage(message))
  const removeMessage = ChatReact.useAction(id, (opened, message: SessionMessage.ID) => opened.removeMessage(message))
  const insets = useSafeAreaInsets()
  const transcriptRef = useRef<TranscriptHandle>(null)
  const composerRef = useRef<ComponentRef<typeof View>>(null)
  const inset = useKeyboardChatComposerInset(transcriptRef, composerRef)
  const [error, setError] = useState("")
  const [away, setAway] = useState(false)
  const live = SessionLive.of(view.state, id)
  SessionPages.useLive(Api.query, id, live)
  const blocked = Boolean(view.permission ?? view.form)

  const attempt = (action: () => Promise<unknown>, fallback: string) => {
    setError("")
    void action().catch((cause: unknown) => setError(ErrorText.of(cause, fallback)))
  }
  const resend = (text: string) => {
    transcriptRef.current?.toEnd()
    attempt(
      () => prompt({ id: SessionMessage.ID.create(), text, delivery: "steer", ...models.selection }),
      "Couldn’t send your message.",
    )
  }
  const stop = () => attempt(interrupt, "Couldn’t stop Ren. Try again.")
  const connected = (app: string) =>
    attempt(
      () =>
        prompt({
          id: SessionMessage.ID.create(),
          text: `I connected ${app}.`,
          delivery: Composer.delivery("queue", { working: view.running }),
          ...models.selection,
        }),
      "Couldn’t send your message.",
    )

  return (
    <View className="flex-1 bg-background">
      <ChatHeader
        id={id}
        title={live.title}
        info={info}
        connection={AsyncResult.getOrElse(view.session.status, () => "connecting")}
        running={view.running}
        usage={view.contextUsage}
        model={models.model}
      />
      {AsyncResult.isFailure(view.session.state) ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="text-center text-muted-foreground">Ren couldn’t open this chat.</Text>
          <Button variant="outline" onPress={reopen}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : null}
      {AsyncResult.isSuccess(view.session.state) ? (
        <Transcript
          root={id}
          spaceId={info?.spaceId}
          handle={transcriptRef}
          inset={inset.contentInsetEndAdjustment}
          keyboardOffset={insets.bottom}
          detail={detail}
          fold={fold}
          foldMessages={foldMessages}
          messages={view.messages}
          rows={view.rows}
          activeMessageID={view.projection?.activeMessageID}
          running={view.running}
          working={view.working}
          statuses={ChatState.pendingStatuses(view.state, view.viewed)}
          modelNames={new Map(models.models.map((each) => [each.id, each.name]))}
          more={ChatState.more(view.state, id)}
          loadingHistory={ChatState.loadingHistory(view.state, id)}
          onLoadMore={() => attempt(loadMore, "Couldn’t load earlier messages.")}
          onRetry={(message) => attempt(() => retryMessage(message), "Couldn’t send your message.")}
          onRemove={(message) =>
            attempt(
              () =>
                removeMessage(message).then((item) => {
                  if (item) draftRef.current?.recall(item)
                }),
              "Couldn’t remove your message.",
            )
          }
          onResend={resend}
          onStop={stop}
          onConnected={connected}
          onAway={setAway}
        />
      ) : null}
      {AsyncResult.isInitial(view.session.state) ? (
        <ActivityIndicator colorClassName="accent-muted-foreground" className="mt-8 flex-1" />
      ) : null}
      <StickyView className="absolute inset-x-0 bottom-0" offset={{ opened: insets.bottom }} pointerEvents="box-none">
        {away ? (
          <View className="items-center pb-3" pointerEvents="box-none">
            <Appear className="rounded-full" rise={false}>
              <Button
                variant="outline"
                size="icon"
                className="size-9 rounded-full bg-card shadow-soft dark:shadow-none"
                aria-label="Scroll to the latest message"
                onPress={() => transcriptRef.current?.toEnd()}
              >
                <Icon as={ArrowDownIcon} className="size-4" />
              </Button>
            </Appear>
          </View>
        ) : null}
        <View ref={composerRef} onLayout={inset.onComposerLayout} pointerEvents="box-none" className="pb-safe-offset-6">
          <ActivityPill root={id} />
          <QueuedMessages root={id} />
          <ChatRequests
            root={id}
            viewed={view.viewed}
            permission={view.permission}
            permissionTitle={view.permissionTitle}
            form={view.form}
            formTitle={view.formTitle}
            formExpired={view.formExpired}
          />
          {error ? (
            <Appear className="mx-3 mb-2 rounded-xl border border-border bg-card px-4 py-2">
              <Text className="text-sm text-destructive">{error}</Text>
            </Appear>
          ) : null}
          {blocked ? null : (
            <ChatComposer
              id={id}
              spaceId={info?.spaceId}
              running={view.running}
              capabilities={info?.capabilities}
              models={models}
              handle={draftRef}
              onSent={() => {
                setError("")
                transcriptRef.current?.toEnd()
              }}
              onError={setError}
              onStop={stop}
            />
          )}
        </View>
      </StickyView>
    </View>
  )
}
