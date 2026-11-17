import { KeyboardAwareLegendList, type useKeyboardChatComposerInset } from "@legendapp/list/keyboard"
import type { LegendListRef } from "@legendapp/list/react-native"
import {
  ChannelReply,
  type ChatState,
  Projection,
  type TimelineDetail,
  type TimelineRow,
  TimelineText,
  TranscriptBlocks,
  TurnProblems,
} from "@ren/chat"
import { Channel } from "@ren/schema/channel"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { type Ref, useImperativeHandle, useRef, useState } from "react"
import { ActivityIndicator, View } from "react-native"
import { Appear } from "#components/appear"
import { CopyButton } from "#components/copy-button"
import { Markdown } from "#components/markdown"
import { Text } from "#components/text"
import { AppConnectCard } from "#features/chat/app-connect"
import { DriveFileCards } from "#features/chat/attachments"
import { Steps, StepRuns, StepsProvider } from "#features/chat/steps"
import { TurnProblem, TurnRetrying } from "#features/chat/turn-problem"
import { UserMessage } from "#features/chat/user-message"

interface Context {
  readonly spaceId: string | undefined
  readonly byId: ReadonlyMap<string, SessionMessage.Info>
  readonly turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
  readonly statuses: ReadonlyMap<string, ChatState.PendingStatus>
  readonly modelNames: ReadonlyMap<string, string>
  readonly activeTurn: string | undefined
  readonly fold: boolean
  readonly foldMessages: boolean
  readonly lastAnswers: ReadonlyMap<string, string>
  readonly onRetry: (id: SessionMessage.ID) => void
  readonly onRemove: (id: SessionMessage.ID) => void
  readonly onResend: (text: string) => void
  readonly onStop: () => void
  readonly onConnected: (app: string) => void
}

function Separator(props: { readonly children: string }) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-px flex-1 bg-border" />
      <Text className="text-xs text-muted-foreground">{props.children}</Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  )
}

function Marker(props: { readonly children: string }) {
  return <Text className="text-sm text-muted-foreground">{props.children}</Text>
}

function NoticeRow(props: { readonly message: SessionMessage.Info | undefined; readonly context: Context }) {
  const message = props.message
  if (message?.type === "compaction") return <Separator>{TimelineText.compaction(message)}</Separator>
  if (message?.type === "model-switched") {
    const model = message.model
    const name = props.context.modelNames.get(model.id) ?? model.id
    const variant = model.variant && model.variant !== "default" ? model.variant : undefined
    return <Separator>{variant ? `${name} · ${variant.charAt(0).toUpperCase()}${variant.slice(1)}` : name}</Separator>
  }
  const notice = message && TimelineText.notice(message)
  if (!notice) return null
  return <Marker>{notice.detail ? `${notice.title} · ${notice.detail}` : notice.title}</Marker>
}

function SystemRow(props: { readonly row: TimelineRow.Row; readonly context: Context }) {
  const row = props.row
  const context = props.context
  const assistants = context.turns.get(row.userMessageID) ?? []
  const user = context.byId.get(row.userMessageID)
  const handlers: TurnProblems.Handlers = {
    ...(user?.type === "user" && { onTryAgain: () => context.onResend(user.text) }),
    onContinue: () => context.onResend("Continue."),
    onStop: context.onStop,
  }
  if (row._tag === "Error")
    return (
      <TurnProblem
        problem={TurnProblems.of({
          kind: row.kind,
          text: row.text,
          assistants,
          modelNames: context.modelNames,
          admin: false,
        })}
        text={row.text}
        handlers={handlers}
      />
    )
  if (row._tag === "Retry") {
    const retrying = context.activeTurn === row.userMessageID ? TurnProblems.retrying(assistants) : undefined
    return retrying ? <TurnRetrying retrying={retrying} handlers={handlers} /> : null
  }
  if (row._tag === "TurnDivider") return <Separator>Interrupted</Separator>
  if (row._tag === "CompactionQueued") return <Separator>Session compaction queued</Separator>
  if (row._tag !== "Notice") return null
  return <NoticeRow message={context.byId.get(row.messageID)} context={context} />
}

function Reply(props: { readonly tool: SessionMessage.Tool }) {
  const reply = ChannelReply.of(props.tool)
  return (
    <View className="gap-1">
      <Text className="text-xs text-muted-foreground">
        {reply.sent ? `Sent on ${Channel.titles[reply.sent.provider]}` : "Sending to the thread…"}
      </Text>
      <Markdown text={reply.text} />
    </View>
  )
}

function StepsBlock(props: {
  readonly block: Extract<TranscriptBlocks.Block, { kind: "steps" }>
  readonly context: Context
}) {
  const turn = props.block.turn
  if (!props.context.fold || props.context.activeTurn === turn) return <StepRuns steps={props.block.steps} />
  const user = props.context.byId.get(turn)
  const milliseconds = TimelineText.turnDuration(
    user?.type === "user" ? user : undefined,
    props.context.turns.get(turn) ?? [],
  )
  return <Steps steps={props.block.steps} workedFor={milliseconds ? TimelineText.duration(milliseconds) : undefined} />
}

function AnswerBlock(props: {
  readonly block: Extract<TranscriptBlocks.Block, { kind: "answer" }>
  readonly context: Context
}) {
  const block = props.block
  const context = props.context
  const copy =
    context.lastAnswers.get(block.turn) === block.key && context.activeTurn !== block.turn
      ? TimelineText.copyText(context.turns.get(block.turn) ?? [])?.text
      : undefined
  return (
    <View className="gap-1">
      <Markdown text={block.text} streaming={block.streaming} />
      {copy ? (
        <View className="-ml-2 flex-row">
          <CopyButton text={copy} />
        </View>
      ) : null}
    </View>
  )
}

function Block(props: { readonly block: TranscriptBlocks.Block; readonly context: Context }) {
  const block = props.block
  const context = props.context
  if (block.kind === "user")
    return (
      <UserMessage
        message={block.message}
        status={context.statuses.get(block.message.id)}
        fold={context.foldMessages}
        spaceId={context.spaceId}
        onRetry={() => context.onRetry(block.message.id)}
        onRemove={() => context.onRemove(block.message.id)}
      />
    )
  if (block.kind === "steps") return <StepsBlock block={block} context={context} />
  if (block.kind === "answer") return <AnswerBlock block={block} context={context} />
  if (block.kind === "reply") return <Reply tool={block.tool} />
  if (block.kind === "empty") return <Marker>Ren sent an empty response.</Marker>
  if (block.kind === "file") return <DriveFileCards spaceId={context.spaceId} files={[block.file]} />
  if (block.kind === "connect")
    return (
      <View className="gap-2">
        {block.connects.map((connect) => (
          <AppConnectCard
            key={`${connect.appId}:${connect.spaceId}`}
            appId={connect.appId}
            spaceId={connect.spaceId}
            onConnected={context.onConnected}
          />
        ))}
      </View>
    )
  return <SystemRow row={block.row} context={context} />
}

interface TranscriptHandle extends Pick<LegendListRef, "reportContentInset"> {
  readonly toEnd: () => void
}

function Transcript(props: {
  readonly root: Session.ID
  readonly spaceId: string | undefined
  readonly handle: Ref<TranscriptHandle>
  readonly inset: ReturnType<typeof useKeyboardChatComposerInset>["contentInsetEndAdjustment"]
  readonly keyboardOffset: number
  readonly detail: TimelineDetail.Detail
  readonly fold: boolean
  readonly foldMessages: boolean
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly rows: ReadonlyArray<TimelineRow.Row>
  readonly activeMessageID: string | undefined
  readonly running: boolean
  readonly working: boolean
  readonly statuses: ReadonlyMap<string, ChatState.PendingStatus>
  readonly modelNames: ReadonlyMap<string, string>
  readonly more: boolean
  readonly loadingHistory: boolean
  readonly onLoadMore: () => void
  readonly onRetry: (id: SessionMessage.ID) => void
  readonly onRemove: (id: SessionMessage.ID) => void
  readonly onResend: (text: string) => void
  readonly onStop: () => void
  readonly onConnected: (app: string) => void
  readonly onAway: (away: boolean) => void
}) {
  const list = useRef<LegendListRef>(null)
  useImperativeHandle(props.handle, (): TranscriptHandle => ({
    toEnd: () => void list.current?.scrollToEnd({ animated: true }),
    reportContentInset: (inset) => list.current?.reportContentInset(inset),
  }))
  const byId: ReadonlyMap<string, SessionMessage.Info> = new Map(props.messages.map((message) => [message.id, message]))
  const turns = Projection.assistantMessagesByParent(props.messages)
  const activeTurn = props.running ? props.activeMessageID : undefined
  const blocks = TranscriptBlocks.withEmptyReplies(
    TranscriptBlocks.groupTurns(TranscriptBlocks.blocksOf(props.rows, byId), {
      live: (turn) => turn === activeTurn,
      fold: props.fold,
    }),
    turns,
    activeTurn,
  )
  const [initial, setInitial] = useState<ReadonlySet<string>>(() => new Set(blocks.map((block) => block.key)))
  if (initial.size === 0 && blocks.length > 0) setInitial(new Set(blocks.map((block) => block.key)))
  const context: Context = {
    spaceId: props.spaceId,
    byId,
    turns,
    statuses: props.statuses,
    modelNames: props.modelNames,
    activeTurn,
    fold: props.fold,
    foldMessages: props.foldMessages,
    lastAnswers: new Map(
      blocks.flatMap((block) => (block.kind === "answer" ? [[block.turn, block.key] as const] : [])),
    ),
    onRetry: props.onRetry,
    onRemove: props.onRemove,
    onResend: props.onResend,
    onStop: props.onStop,
    onConnected: props.onConnected,
  }
  return (
    <StepsProvider root={props.root} detail={props.detail}>
      <KeyboardAwareLegendList
        data={blocks}
        extraData={context}
        keyExtractor={(block) => block.key}
        renderItem={(item) =>
          initial.size > 0 && !initial.has(item.item.key) && item.index >= blocks.length - 2 ? (
            <Appear className="px-5 py-3">
              <Block block={item.item} context={context} />
            </Appear>
          ) : (
            <View className="px-5 py-3">
              <Block block={item.item} context={context} />
            </View>
          )
        }
        estimatedItemSize={120}
        drawDistance={1000}
        scrollEventThrottle={32}
        initialScrollAtEnd
        alignItemsAtEnd
        maintainScrollAtEnd={{ animated: true }}
        maintainVisibleContentPosition
        contentInsetEndAdjustment={props.inset}
        keyboardOffset={props.keyboardOffset}
        keyboardDismissMode="interactive"
        onScroll={() => props.onAway(!(list.current?.getState().isWithinMaintainScrollAtEndThreshold ?? true))}
        onStartReached={() => {
          if (props.more && !props.loadingHistory) props.onLoadMore()
        }}
        ListHeaderComponent={
          props.loadingHistory ? <ActivityIndicator colorClassName="accent-muted-foreground" className="py-4" /> : null
        }
        ListEmptyComponent={<Text className="p-6 text-center text-muted-foreground">No messages yet.</Text>}
        ListFooterComponent={
          props.working ? (
            <View className="flex-row items-center gap-2 px-5 py-3">
              <ActivityIndicator colorClassName="accent-muted-foreground" size="small" />
              <Text className="text-sm text-muted-foreground">Working on the next step</Text>
            </View>
          ) : null
        }
        ref={list}
      />
    </StepsProvider>
  )
}

export { Transcript, type TranscriptHandle }
