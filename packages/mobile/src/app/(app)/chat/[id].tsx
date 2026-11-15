import { useKeyboardChatComposerInset } from "@legendapp/list/keyboard"
import { useAtomRefresh } from "@effect/atom-react"
import { ChatState, Composer, SessionLive, SessionTitle } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionInfo } from "@ren/client"
import { Seed, SessionPages } from "@ren/client/react"
import { ErrorText } from "@ren/util/error-text"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AsyncResult } from "effect/reactivity"
import { useLocalSearchParams } from "expo-router"
import { Drawer } from "expo-router/drawer"
import { useNetworkState } from "expo-network"
import { type ComponentRef, useRef, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import ArrowDownIcon from "react-native-heroicons/mini/ArrowDownIcon"
import { KeyboardStickyView } from "react-native-keyboard-controller"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { withUniwind } from "uniwind"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import { ActivityPill } from "#features/chat/activity-pill"
import { useAttachments } from "#features/chat/attachments"
import { ChatRequests } from "#features/chat/chat-requests"
import { PromptInput } from "#features/chat/prompt-input"
import { QueuedMessages } from "#features/chat/queued-messages"
import { Transcript, type TranscriptHandle } from "#features/chat/transcript"
import { Api } from "#lib/api"
import { Preferences } from "#lib/preferences"

const StickyView = withUniwind(KeyboardStickyView)

function Header(props: { readonly title: string; readonly status: string | undefined }) {
  return (
    <View className="items-center">
      <Text className="text-sm text-muted-foreground" numberOfLines={1}>
        {props.title}
      </Text>
      {props.status ? <Text className="text-xs text-muted-foreground/70">{props.status}</Text> : null}
    </View>
  )
}

export default function ChatRoute() {
  const id = Session.ID.make(useLocalSearchParams<{ id: string }>().id)
  return <Chat key={id} id={id} />
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
  const models = ChatReact.useModels(id)
  const reopen = useAtomRefresh(ChatReact.useAtoms().session(id))
  const loadMore = ChatReact.useAction(id, (opened) => opened.loadMore(id))
  const prompt = ChatReact.usePrompt(id)
  const interrupt = ChatReact.useAction(id, (opened) => opened.interrupt)
  const retryMessage = ChatReact.useAction(id, (opened, message: SessionMessage.ID) => opened.retryMessage(message))
  const removeMessage = ChatReact.useAction(id, (opened, message: SessionMessage.ID) => opened.removeMessage(message))
  const offline = useNetworkState().isConnected === false
  const connection = AsyncResult.getOrElse(view.session.status, () => "connecting")
  const insets = useSafeAreaInsets()
  const transcriptRef = useRef<TranscriptHandle>(null)
  const composerRef = useRef<ComponentRef<typeof View>>(null)
  const inset = useKeyboardChatComposerInset(transcriptRef, composerRef)
  const [draft, setDraft] = useState<Composer.Draft>(Composer.empty)
  const attachments = useAttachments({ sessionId: id, spaceId: info?.spaceId, draft, update: setDraft })
  const [error, setError] = useState("")
  const [away, setAway] = useState(false)
  const live = SessionLive.of(view.state, id)
  SessionPages.useLive(Api.query, id, live)
  const status = [
    { when: offline, label: "Offline" },
    { when: connection === "reconnecting", label: "Reconnecting…" },
    { when: connection === "connecting", label: "Connecting…" },
  ].find((each) => each.when)?.label
  const blocked = Boolean(view.permission ?? view.form)

  const attempt = (action: () => Promise<unknown>, fallback: string) => {
    setError("")
    void action().catch((cause: unknown) => setError(ErrorText.of(cause, fallback)))
  }
  const resend = (text: string) =>
    attempt(() => prompt({ id: SessionMessage.ID.create(), text, delivery: "steer" }), "Couldn’t send your message.")
  const send = () => {
    const text = Composer.request(draft).text.trim()
    const submission = Composer.submission(draft, {
      working: view.running,
      behavior: "queue",
      alternative: false,
      queue: info?.capabilities.queue !== false,
      current: undefined,
    })
    if (!text || !submission) return
    const messageID = Composer.messageID(draft) ?? SessionMessage.ID.create()
    setDraft(submission.next)
    setError("")
    void prompt({ id: messageID, text, delivery: submission.delivery, files: Composer.files(draft) }).catch(
      (cause: unknown) => {
        setDraft((current) => Composer.restore(current, submission.sent, messageID))
        setError(ErrorText.of(cause, "Couldn’t send your message. Your draft has been kept."))
      },
    )
  }
  const stop = () => attempt(interrupt, "Couldn’t stop Ren. Try again.")

  return (
    <View className="flex-1 bg-background">
      <Drawer.Screen
        options={{
          headerTitleAlign: "center",
          headerTitle: () => <Header title={SessionTitle.display(live.title ?? info?.title)} status={status} />,
        }}
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
          modelNames={new Map(AsyncResult.getOrElse(models, () => []).map((model) => [model.id, model.name]))}
          more={ChatState.more(view.state, id)}
          loadingHistory={ChatState.loadingHistory(view.state, id)}
          onLoadMore={() => attempt(loadMore, "Couldn’t load earlier messages.")}
          onRetry={(message) => attempt(() => retryMessage(message), "Couldn’t send your message.")}
          onRemove={(message) =>
            attempt(
              () =>
                removeMessage(message).then((item) => {
                  if (item) setDraft((current) => Composer.recall(current, item))
                }),
              "Couldn’t remove your message.",
            )
          }
          onResend={resend}
          onStop={stop}
          onAway={setAway}
        />
      ) : null}
      {AsyncResult.isInitial(view.session.state) ? (
        <ActivityIndicator colorClassName="accent-muted-foreground" className="mt-8 flex-1" />
      ) : null}
      <StickyView className="absolute inset-x-0 bottom-0" offset={{ opened: insets.bottom }} pointerEvents="box-none">
        {away ? (
          <View className="items-center pb-3" pointerEvents="box-none">
            <Button
              variant="outline"
              size="icon"
              className="size-9 rounded-full bg-card shadow-soft dark:shadow-none"
              aria-label="Scroll to the latest message"
              onPress={() => transcriptRef.current?.toEnd()}
            >
              <Icon as={ArrowDownIcon} className="size-4" />
            </Button>
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
            <View className="mx-3 mb-2 rounded-xl border border-border bg-card px-4 py-2">
              <Text className="text-sm text-destructive">{error}</Text>
            </View>
          ) : null}
          {blocked ? null : (
            <PromptInput
              value={draft.text}
              onChange={(text) => setDraft((current) => Composer.withText(current, text))}
              onSend={send}
              onStop={stop}
              running={view.running}
              attachments={attachments}
            />
          )}
        </View>
      </StickyView>
    </View>
  )
}
