import type { TaskInfo } from "@ren/client"
import { Pressable, View } from "react-native"
import HandRaisedIcon from "react-native-heroicons/mini/HandRaisedIcon"
import LinkIcon from "react-native-heroicons/mini/LinkIcon"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import {
  formatShortDate,
  LabelDot,
  PriorityIcon,
  StatusGlyph,
  TaskAssignee,
  type Member,
} from "#features/tasks/task-meta"

function Dot() {
  return <Text className="text-xs text-muted-foreground">·</Text>
}

function TaskRow(props: {
  readonly task: TaskInfo
  readonly spaceName: string | undefined
  readonly owner: Member | undefined
  readonly onPress: () => void
  readonly onLongPress: () => void
  readonly onStatus: () => void
}) {
  const task = props.task
  const extras = task.labels.length > 0 || Boolean(task.dueAt) || task.links.length > 0
  return (
    <Pressable
      role="link"
      aria-label={`${task.identifier} ${task.title}`}
      className="mx-3 mb-2 flex-row gap-3 rounded-xl border border-border bg-card py-3 pr-3 pl-1.5 active:bg-accent"
      onPress={props.onPress}
      onLongPress={props.onLongPress}
    >
      <Pressable
        role="button"
        aria-label={`Status for ${task.title}`}
        hitSlop={8}
        className="size-7 items-center justify-center rounded-md active:bg-muted"
        onPress={props.onStatus}
      >
        <StatusGlyph status={task.status} />
      </Pressable>
      <View className="min-w-0 flex-1 gap-1.5 pt-0.5">
        <Text className="font-medium" numberOfLines={2}>
          {task.title}
        </Text>
        <View className="flex-row items-center gap-1.5">
          <Text className="text-xs text-muted-foreground tabular-nums">{task.identifier}</Text>
          <Dot />
          <PriorityIcon priority={task.priority} className="size-3.5" />
          {props.spaceName ? (
            <>
              <Dot />
              <Text className="shrink text-xs text-muted-foreground" numberOfLines={1}>
                {props.spaceName}
              </Text>
            </>
          ) : null}
          {task.humanReview ? (
            <>
              <Dot />
              <Icon as={HandRaisedIcon} className="size-3.5 text-chart-3" />
              <Text className="text-xs text-muted-foreground">Needs review</Text>
            </>
          ) : null}
        </View>
        {extras ? (
          <View className="flex-row flex-wrap items-center gap-1.5">
            {task.labels.map((label) => (
              <View key={label.id} className="h-5 flex-row items-center gap-1.5 rounded-full bg-muted px-2">
                <LabelDot color={label.color} />
                <Text className="text-xs">{label.name}</Text>
              </View>
            ))}
            {task.dueAt ? <Text className="text-xs text-muted-foreground">{formatShortDate(task.dueAt)}</Text> : null}
            {task.links.length > 0 ? (
              <View className="flex-row items-center gap-0.5">
                <Icon as={LinkIcon} className="size-3.5 text-muted-foreground" />
                <Text className="text-xs text-muted-foreground tabular-nums">{task.links.length}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      <View className="size-6 items-center justify-center">
        <TaskAssignee task={task} owner={props.owner} />
      </View>
    </Pressable>
  )
}

export { TaskRow }
