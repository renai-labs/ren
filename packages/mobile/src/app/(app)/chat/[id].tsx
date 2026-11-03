import { KeyboardAwareLegendList, useKeyboardChatComposerInset } from "@legendapp/list/keyboard"
import type { LegendListRef } from "@legendapp/list/react-native"
import { useAtomRefresh } from "@effect/atom-react"
import {
  ChatState,
  Projection,
  SessionLive,
  SessionTitle,
  TimelineText,
  ToolDisplay,
  TranscriptBlocks,
} from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import type { SessionInfo } from "@ren/client"
import { Seed, SessionPages } from "@ren/client/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AsyncResult } from "effect/reactivity"
import { useLocalSearchParams } from "expo-router"
import { Drawer } from "expo-router/drawer"
import { type ComponentRef, useRef, useState } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import IconChevronDown from "@tabler/icons-react-native/IconChevronDown"
import IconChevronRight from "@tabler/icons-react-native/IconChevronRight"
import IconClock from "@tabler/icons-react-native/IconClock"
import IconFile from "@tabler/icons-react-native/IconFile"
import IconFilePencil from "@tabler/icons-react-native/IconFilePencil"
import IconFileSearch from "@tabler/icons-react-native/IconFileSearch"
import IconPlug from "@tabler/icons-react-native/IconPlug"
import IconSubtask from "@tabler/icons-react-native/IconSubtask"
import IconTerminal2 from "@tabler/icons-react-native/IconTerminal2"
import IconWorldWww from "@tabler/icons-react-native/IconWorldWww"
import { useNetworkState } from "expo-network"
import { KeyboardStickyView } from "react-native-keyboard-controller"
import { withUniwind } from "uniwind"
import { Button } from "#components/button"
import { ChatRequests } from "#components/chat-requests"
import { Composer } from "#components/composer"
import { Icon } from "#components/icon"
import { Markdown } from "#components/markdown"
import { NewChatButton } from "#components/new-chat-button"
import { Text } from "#components/text"
import { Api } from "#lib/api"

const toolIcons = {
  command: IconTerminal2,
  file: IconFile,
  edit: IconFilePencil,
  search: IconFileSearch,
  web: IconWorldWww,
  agent: IconSubtask,
  tool: IconPlug,
} satisfies Record<ToolDisplay.Kind, unknown>

function StepRow(props: { readonly step: TranscriptBlocks.Step }) {
  const step = props.step
  if (step.kind === "text") return <Markdown text={step.text} streaming={step.streaming} size="sm" />
  if (step.kind === "shell")
    return (
      <View className="flex-row items-center gap-2">
        <Icon as={IconTerminal2} className="size-4 text-muted-foreground" />
        <Text className="text-sm font-medium text-muted-foreground">Ran</Text>
        <Text className="flex-1 font-mono text-xs text-muted-foreground" numberOfLines={1}>
          {step.message.command}
        </Text>
      </View>
    )
  if (step.kind !== "tool") return null
  const status = ToolDisplay.status(step.tool)
  const subject = [ToolDisplay.subtitle(step.tool), ToolDisplay.matches(step.tool)].filter(Boolean).join(" · ")
  return (
    <View className="flex-row items-center gap-2">
      {status === "running" ? (
        <ActivityIndicator size="small" className="size-4" />
      ) : (
        <Icon
          as={toolIcons[ToolDisplay.kind(step.tool)]}
          className={status === "failed" ? "size-4 text-destructive" : "size-4 text-muted-foreground"}
        />
      )}
      <Text
        className={
          status === "failed" ? "text-sm font-medium text-destructive" : "text-sm font-medium text-muted-foreground"
        }
      >
        {ToolDisplay.label(step.tool)}
      </Text>
      {subject ? (
        <Text className="flex-1 font-mono text-xs text-muted-foreground" numberOfLines={1}>
          {subject}
        </Text>
      ) : null}
    </View>
  )
}

const worked = (turn: { readonly running: boolean; readonly workedFor: string | undefined }) => {
  if (turn.running) return "Working"
  return turn.workedFor ? `Worked for ${turn.workedFor}` : "Worked"
}

function StepsView(props: {
  readonly steps: ReadonlyArray<TranscriptBlocks.Step>
  readonly running: boolean
  readonly workedFor: string | undefined
}) {
  const [open, setOpen] = useState(false)
  const count = props.steps.filter((step) => step.kind !== "text").length
  return (
    <View className="gap-3">
      <Pressable
        role="button"
        aria-expanded={open}
        className="flex-row items-center gap-2 self-start"
        onPress={() => setOpen(!open)}
      >
        <Icon as={IconClock} className="size-4 text-muted-foreground" />
        <Text className="text-sm text-muted-foreground">{worked(props)}</Text>
        <Text className="text-sm text-muted-foreground/70">{count === 1 ? "1 step" : `${count} steps`}</Text>
        <Icon as={open ? IconChevronDown : IconChevronRight} className="size-4 text-muted-foreground" />
      </Pressable>
      {open ? (
        <View className="gap-2.5 pl-6">
          {props.steps.map((step) => (
            <StepRow key={step.key} step={step} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

function SystemRow(props: { readonly row: TranscriptBlocks.Block & { readonly kind: "row" } }) {
  const row = props.row.row
  if (row._tag === "Error") return <Text className="text-sm text-destructive">{row.text}</Text>
  if (row._tag === "Retry") return <Text variant="muted">Retrying…</Text>
  if (row._tag === "TurnDivider") return <Text variant="muted">Interrupted</Text>
  if (row._tag === "CompactionQueued") return <Text variant="muted">Session compaction queued</Text>
  return null
}

const StickyView = withUniwind(KeyboardStickyView)

function Header(props: { readonly title: string; readonly status: string | undefined }) {
  return (
    <View className="items-center">
      <Text className="font-semibold" numberOfLines={1}>
        {props.title}
      </Text>
      {props.status ? <Text className="text-xs text-muted-foreground">{props.status}</Text> : null}
    </View>
  )
}

function BlockView(props: {
  readonly block: TranscriptBlocks.Block
  readonly status?: ChatState.PendingStatus | undefined
  readonly running: boolean
  readonly workedFor: string | undefined
}) {
  const block = props.block
  if (block.kind === "user")
    return (
      <View className="max-w-5/6 gap-1 self-end">
        <View className="rounded-xl rounded-tr-md bg-muted px-4 py-2">
          <Text className="leading-relaxed">{block.message.text}</Text>
        </View>
        {props.status ? (
          <Text className="self-end text-xs text-muted-foreground">
            {props.status === "queued" ? "Queued" : "Sending…"}
          </Text>
        ) : null}
      </View>
    )
  if (block.kind === "answer") return <Markdown text={block.text} streaming={block.streaming} />
  if (block.kind === "steps")
    return <StepsView steps={block.steps} running={props.running} workedFor={props.workedFor} />
  if (block.kind === "reply") return <Text variant="muted">{ToolDisplay.label(block.tool)}</Text>
  if (block.kind === "file") return <Text variant="muted">{block.file.name}</Text>
  return <SystemRow row={block} />
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
  const view = ChatReact.useView(id, undefined)
  const reopen = useAtomRefresh(ChatReact.useAtoms().session(id))
  const loadMore = ChatReact.useAction(id, (opened) => opened.loadMore(id))
  const offline = useNetworkState().isConnected === false
  const connection = AsyncResult.getOrElse(view.session.status, () => "connecting")
  const prompt = ChatReact.usePrompt(id)
  const interrupt = ChatReact.useAction(id, (opened) => opened.interrupt)
  const listRef = useRef<LegendListRef>(null)
  const composerRef = useRef<ComponentRef<typeof View>>(null)
  const inset = useKeyboardChatComposerInset(listRef, composerRef)
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const byId: ReadonlyMap<string, SessionMessage.Info> = new Map(view.messages.map((message) => [message.id, message]))
  const blocks = TranscriptBlocks.of(view.rows, byId)
  const statuses = ChatState.pendingStatuses(view.state, view.viewed)
  const turns = Projection.assistantMessagesByParent(view.messages)
  const activeTurn = view.running ? view.projection?.activeMessageID : undefined
  const workedFor = (turn: string) => {
    const user = byId.get(turn)
    const milliseconds = TimelineText.turnDuration(user?.type === "user" ? user : undefined, turns.get(turn) ?? [])
    return milliseconds ? TimelineText.duration(milliseconds) : undefined
  }
  const more = ChatState.more(view.state, id)
  const loadingHistory = ChatState.loadingHistory(view.state, id)
  const live = SessionLive.of(view.state, id)
  SessionPages.useLive(Api.query, id, live)
  const status = [
    { when: offline, label: "Offline" },
    { when: connection === "reconnecting", label: "Reconnecting…" },
    { when: connection === "connecting", label: "Connecting…" },
    { when: view.running, label: "Working…" },
  ].find((each) => each.when)?.label

  const send = () => {
    const message = text.trim()
    if (!message) return
    setText("")
    setError("")
    void prompt({ id: SessionMessage.ID.create(), text: message, delivery: "steer" }).catch(() => {
      setText(message)
      setError("Couldn’t send your message. Try again.")
    })
  }
  const stop = () => void interrupt().catch(() => setError("Couldn’t stop Ren. Try again."))

  return (
    <View className="flex-1 bg-background">
      <Drawer.Screen
        options={{
          headerTitle: () => <Header title={SessionTitle.display(live.title ?? info?.title)} status={status} />,
        }}
      />
      {AsyncResult.isFailure(view.session.state) ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="text-center">Couldn’t open this chat.</Text>
          <Button variant="outline" onPress={reopen}>
            <Text>Try again</Text>
          </Button>
        </View>
      ) : null}
      {AsyncResult.isSuccess(view.session.state) ? (
        <KeyboardAwareLegendList
          ref={listRef}
          data={blocks}
          keyExtractor={(block) => block.key}
          renderItem={(item) => (
            <View className="px-5 py-3">
              <BlockView
                block={item.item}
                status={item.item.kind === "user" ? statuses.get(item.item.message.id) : undefined}
                running={item.item.kind === "steps" && item.item.turn === activeTurn}
                workedFor={item.item.kind === "steps" ? workedFor(item.item.turn) : undefined}
              />
            </View>
          )}
          estimatedItemSize={80}
          initialScrollAtEnd
          alignItemsAtEnd
          maintainScrollAtEnd
          maintainVisibleContentPosition
          contentInsetEndAdjustment={inset.contentInsetEndAdjustment}
          keyboardDismissMode="interactive"
          onStartReached={() => {
            if (more && !loadingHistory) void loadMore().catch(() => setError("Couldn’t load earlier messages."))
          }}
          ListHeaderComponent={loadingHistory ? <ActivityIndicator className="py-4" /> : null}
          ListEmptyComponent={<Text className="p-6 text-center text-muted-foreground">No messages yet.</Text>}
          ListFooterComponent={
            view.working ? (
              <View className="flex-row items-center gap-2 px-5 py-3">
                <ActivityIndicator size="small" />
                <Text className="text-sm text-muted-foreground">Working on the next step</Text>
              </View>
            ) : null
          }
        />
      ) : null}
      {AsyncResult.isInitial(view.session.state) ? <ActivityIndicator className="mt-8 flex-1" /> : null}
      <StickyView className="absolute inset-x-0 bottom-0">
        <View ref={composerRef} onLayout={inset.onComposerLayout} pointerEvents="box-none">
          <View className="items-end px-5 pb-3" pointerEvents="box-none">
            <NewChatButton />
          </View>
          <ChatRequests
            root={id}
            viewed={view.viewed}
            permission={view.permission}
            permissionTitle={view.permissionTitle}
            form={view.form}
            formTitle={view.formTitle}
            formExpired={view.formExpired}
          />
          {error ? <Text className="bg-background px-4 pt-2 text-sm text-destructive">{error}</Text> : null}
          <Composer value={text} onChange={setText} onSend={send} onStop={stop} running={view.running} />
        </View>
      </StickyView>
    </View>
  )
}
