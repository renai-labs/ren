import { SessionTitle } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { TaskActivityInfo, TaskActor, TaskEventInfo } from "@ren/client"
import { Tasks } from "@ren/client/react"
import { Session } from "@ren/schema/session"
import { TaskEvent } from "@ren/schema/task-event"
import { ErrorText } from "@ren/util/error-text"
import { RelativeTime } from "@ren/util/relative-time"
import IconFlagCheck from "@tabler/icons-react-native/IconFlagCheck"
import IconGhostFilled from "@tabler/icons-react-native/IconGhostFilled"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ActivityIndicator, Alert, Pressable, View } from "react-native"
import ArchiveBoxIcon from "react-native-heroicons/mini/ArchiveBoxIcon"
import ArrowRightIcon from "react-native-heroicons/mini/ArrowRightIcon"
import ArrowUturnLeftIcon from "react-native-heroicons/mini/ArrowUturnLeftIcon"
import ChatBubbleLeftIcon from "react-native-heroicons/mini/ChatBubbleLeftIcon"
import CheckIcon from "react-native-heroicons/mini/CheckIcon"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import HandRaisedIcon from "react-native-heroicons/mini/HandRaisedIcon"
import LinkIcon from "react-native-heroicons/mini/LinkIcon"
import PencilIcon from "react-native-heroicons/mini/PencilIcon"
import PlusCircleIcon from "react-native-heroicons/mini/PlusCircleIcon"
import QueueListIcon from "react-native-heroicons/mini/QueueListIcon"
import StopIcon from "react-native-heroicons/mini/StopIcon"
import TagIcon from "react-native-heroicons/mini/TagIcon"
import { Avatar } from "#components/avatar"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Markdown } from "#components/markdown"
import { Text } from "#components/text"
import { StatusGlyph, type TaskLookups } from "#features/tasks/task-meta"
import { Api } from "#lib/api"

const eventIcons = {
  created: PlusCircleIcon,
  assigned: ArrowRightIcon,
  started: ChatBubbleLeftIcon,
  review_requested: HandRaisedIcon,
  finished: IconFlagCheck,
  field: PencilIcon,
  label: TagIcon,
  link: LinkIcon,
  parent: QueueListIcon,
  archived: ArchiveBoxIcon,
} as const

function EventMark(props: { readonly data: TaskEventInfo["data"] }) {
  const data = props.data
  if (data._tag === "status") return <StatusGlyph status={data.to} />
  if (data._tag === "reviewed")
    return (
      <Icon
        as={data.decision === "approved" ? CheckIcon : ArrowUturnLeftIcon}
        className="size-4 text-muted-foreground"
      />
    )
  return <Icon as={eventIcons[data._tag]} className="size-4 text-muted-foreground" />
}

function StopSession(props: { readonly sessionId: Session.ID; readonly agent: string }) {
  const stop = ChatReact.useAction(props.sessionId, (opened) => opened.stop(props.sessionId))
  const [stopping, setStopping] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 rounded-full"
      aria-label={`Stop ${props.agent}’s session`}
      disabled={stopping}
      onPress={() => {
        setStopping(true)
        void stop()
          .catch((cause: unknown) => Alert.alert("Couldn’t stop the session", ErrorText.of(cause)))
          .finally(() => setStopping(false))
      }}
    >
      {stopping ? <ActivityIndicator size="small" /> : <Icon as={StopIcon} className="size-3.5" />}
      <Text className="text-sm">Stop</Text>
    </Button>
  )
}

const sessionStates = { busy: "Working", idle: "Finished" } as const

function SessionCard(props: {
  readonly event: TaskEventInfo
  readonly sessionId: string
  readonly agent: string
  readonly by: string
  readonly onOpen: (sessionId: string) => void
}) {
  const session = useQuery({
    ...Api.query.session.get.queryOptions({ idOrSlug: props.sessionId }),
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === "busy" ? Tasks.refreshEvery : false),
  })
  const status = session.data?.status
  return (
    <Pressable
      role="link"
      aria-label={`Open ${props.agent}’s session`}
      className="overflow-hidden rounded-xl border border-border bg-card active:bg-accent"
      onPress={() => props.onOpen(props.sessionId)}
    >
      <View className="flex-row items-center gap-2 border-b border-border px-3.5 py-2.5">
        <Icon as={ChatBubbleLeftIcon} className="size-4 text-muted-foreground" />
        <Text className="shrink text-sm" numberOfLines={1}>
          <Text className="text-sm font-medium">{props.agent}</Text>
          <Text className="text-sm text-muted-foreground">
            {" "}
            started by {props.by} · {RelativeTime.format(props.event.createdAt)}
          </Text>
        </Text>
      </View>
      <View className="min-h-12 flex-row items-center gap-2 px-3.5 py-2">
        {status === "busy" ? (
          <ActivityIndicator size="small" />
        ) : (
          <View aria-hidden className="mx-1 size-2 rounded-full bg-muted-foreground/60" />
        )}
        <Text className={status === "busy" ? "text-sm" : "text-sm text-muted-foreground"}>
          {status ? sessionStates[status] : "Session"}
        </Text>
        <Text className="min-w-0 flex-1 text-sm" numberOfLines={1}>
          {session.data?.title ? SessionTitle.display(session.data.title) : ""}
        </Text>
        {status === "busy" ? (
          <StopSession sessionId={Session.ID.make(props.sessionId)} agent={props.agent} />
        ) : (
          <Icon as={ChevronRightIcon} className="size-4 text-muted-foreground" />
        )}
      </View>
    </Pressable>
  )
}

function ActorMark(props: { readonly actor: TaskActor; readonly name: string }) {
  if (props.actor.agentId) return <Icon as={IconGhostFilled} className="size-5 text-muted-foreground" />
  return <Avatar name={props.name} />
}

function CommentCard(props: {
  readonly comment: Extract<TaskActivityInfo, { type: "comment" }>["comment"]
  readonly name: string
}) {
  return (
    <View className="gap-2 rounded-xl border border-border bg-card px-4 py-3">
      <View className="flex-row items-center gap-2">
        <View className="size-6 items-center justify-center">
          <View className="scale-75">
            <ActorMark actor={props.comment.author} name={props.name} />
          </View>
        </View>
        <Text className="text-sm font-medium">{props.name}</Text>
        <Text className="text-sm text-muted-foreground">{RelativeTime.format(props.comment.createdAt)}</Text>
      </View>
      <Markdown text={props.comment.body} size="sm" />
    </View>
  )
}

function TaskActivity(props: {
  readonly taskId: string
  readonly lookups: TaskLookups
  readonly onOpenSession: (sessionId: string) => void
}) {
  const activity = useQuery(Tasks.activity(Api.client, props.taskId))
  const lookups = props.lookups
  const names: TaskEvent.Names = {
    agent: (agentId) => lookups.agent(agentId)?.name,
    person: (userId) => lookups.member(userId)?.name,
    space: lookups.spaceName,
  }
  return (
    <View className="gap-4">
      <Text role="heading" aria-level={2} className="font-semibold">
        Activity
      </Text>
      {activity.isPending ? <ActivityIndicator className="self-start" /> : null}
      {activity.isError ? <Text className="text-sm text-muted-foreground">Couldn’t load the activity.</Text> : null}
      {(activity.data ?? []).map((item) => {
        if (item.type === "comment")
          return (
            <CommentCard key={item.id} comment={item.comment} name={TaskEvent.actorName(item.comment.author, names)} />
          )
        const event = item.event
        const data = event.data
        const actor = TaskEvent.actorName(event.actor, names)
        if (data._tag === "started")
          return (
            <SessionCard
              key={item.id}
              event={event}
              sessionId={data.sessionId}
              agent={names.agent(data.agentId) ?? "Agent"}
              by={actor}
              onOpen={props.onOpenSession}
            />
          )
        const note = TaskEvent.note(data)
        return (
          <View key={item.id} className="gap-1">
            <View className="flex-row gap-2.5">
              <View className="h-5 w-4 items-center justify-center">
                <EventMark data={data} />
              </View>
              <Text className="flex-1 text-sm text-muted-foreground">
                <Text className="text-sm font-medium">{actor}</Text> {TaskEvent.describe(data, names)}
                <Text className="text-sm text-muted-foreground/70"> · {RelativeTime.format(event.createdAt)}</Text>
              </Text>
            </View>
            {note ? <Text className="pl-6.5 text-sm text-muted-foreground">{note}</Text> : null}
          </View>
        )
      })}
    </View>
  )
}

export { TaskActivity }
