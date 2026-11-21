import type { TaskInfo } from "@ren/client"
import type { Tasks } from "@ren/client/react"
import { Task } from "@ren/schema/task"
import IconGhostFilled from "@tabler/icons-react-native/IconGhostFilled"
import { useState, type ReactNode } from "react"
import { Pressable, View } from "react-native"
import CalendarDaysIcon from "react-native-heroicons/mini/CalendarDaysIcon"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import CubeIcon from "react-native-heroicons/mini/CubeIcon"
import TagIcon from "react-native-heroicons/mini/TagIcon"
import UserCircleIcon from "react-native-heroicons/mini/UserCircleIcon"
import { Avatar } from "#components/avatar"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import {
  dueAt,
  dueOptions,
  isPriority,
  isStatus,
  LabelDot,
  PriorityIcon,
  priorityOptions,
  StatusGlyph,
  statusOptions,
  TaskAssignee,
  type TaskLookups,
} from "#features/tasks/task-meta"
import { OptionSheet } from "#components/option-sheet"

type Assignment = { readonly agentId?: string | null; readonly ownerId?: string | null; readonly spaceId?: string }

type Picking = "status" | "priority" | "assignee" | "due" | "labels" | "space"

const longDate = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" })

function Property(props: {
  readonly label: string
  readonly icon: ReactNode
  readonly value: ReactNode
  readonly disabled: boolean
  readonly onPress: () => void
}) {
  return (
    <Pressable
      role="button"
      aria-label={props.label}
      disabled={props.disabled}
      className="min-h-11 flex-row items-center gap-3 active:opacity-70"
      onPress={props.onPress}
    >
      <Text className="w-20 text-sm text-muted-foreground">{props.label}</Text>
      <View className="size-5 items-center justify-center">{props.icon}</View>
      <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-1.5">{props.value}</View>
      {props.disabled ? null : <Icon as={ChevronRightIcon} className="size-4 text-muted-foreground" />}
    </Pressable>
  )
}

function LabelsSheet(props: {
  readonly task: TaskInfo
  readonly lookups: TaskLookups
  readonly onChange: (patch: Tasks.Patch) => void
  readonly onClose: () => void
}) {
  const [names, setNames] = useState(() => props.task.labels.map((label) => label.name))
  const options = [
    ...props.lookups.labels.map((label) => ({ value: label.name, label: label.name, color: label.color })),
    ...names
      .filter((name) => !props.lookups.labels.some((label) => label.name === name))
      .map((name) => ({ value: name, label: name, color: null })),
  ]
  const toggle = (name: string) => {
    const next = names.includes(name) ? names.filter((each) => each !== name) : [...names, name]
    setNames(next)
    props.onChange({ labels: next })
  }
  return (
    <OptionSheet
      open
      title="Labels"
      multiple
      searchable
      options={options.map((option) => ({
        value: option.value,
        label: option.label,
        icon: <LabelDot color={option.color} />,
      }))}
      selected={names}
      onSelect={toggle}
      onCreate={toggle}
      onClose={props.onClose}
    />
  )
}

function LabelChips(props: { readonly labels: TaskInfo["labels"] }) {
  if (props.labels.length === 0) return <Text className="text-muted-foreground">Add label</Text>
  return props.labels.map((label) => (
    <View key={label.id} className="h-6 flex-row items-center gap-1.5 rounded-full bg-muted px-2.5">
      <LabelDot color={label.color} />
      <Text className="text-sm">{label.name}</Text>
    </View>
  ))
}

const assigneeOf = (task: TaskInfo) => {
  if (task.agentId) return `agent:${task.agentId}`
  if (task.ownerId) return `person:${task.ownerId}`
  return "none"
}

function AssigneeSheet(props: {
  readonly open: boolean
  readonly task: TaskInfo
  readonly lookups: TaskLookups
  readonly onAssign: (target: Assignment) => void
  readonly onClose: () => void
}) {
  const lookups = props.lookups
  return (
    <OptionSheet
      open={props.open}
      title="Assignee"
      searchable={lookups.agents.length + lookups.members.length > 6}
      options={[
        {
          value: "none",
          label: "Unassigned",
          icon: <Icon as={UserCircleIcon} className="size-4.5 text-muted-foreground" />,
        },
        ...lookups.agents.map((agent) => ({
          value: `agent:${agent.id}`,
          label: agent.name,
          group: "Assign to an agent",
          icon: <Icon as={IconGhostFilled} className="size-4.5 text-muted-foreground" />,
        })),
        ...lookups.members.map((member) => ({
          value: `person:${member.id}`,
          label: member.name,
          group: "Assign to a person",
          icon: <Avatar size="sm" name={member.name} />,
        })),
      ]}
      selected={[assigneeOf(props.task)]}
      onSelect={(value) => {
        if (value.startsWith("agent:")) props.onAssign({ agentId: value.slice("agent:".length) })
        else if (value.startsWith("person:")) props.onAssign({ agentId: null, ownerId: value.slice("person:".length) })
        else props.onAssign({ agentId: null, ownerId: null })
      }}
      onClose={props.onClose}
    />
  )
}

function TaskProperties(props: {
  readonly task: TaskInfo
  readonly lookups: TaskLookups
  readonly onChange: (patch: Tasks.Patch) => void
  readonly onAssign: (target: Assignment) => void
}) {
  const task = props.task
  const lookups = props.lookups
  const [picking, setPicking] = useState<Picking>()
  const close = () => setPicking(undefined)
  const owner = lookups.member(task.ownerId)
  const assignee = lookups.agent(task.agentId)?.name ?? owner?.name
  const disabled = !task.canUpdate
  return (
    <View>
      <Property
        label="Status"
        icon={<StatusGlyph status={task.status} />}
        value={<Text>{Task.statusLabels[task.status]}</Text>}
        disabled={disabled}
        onPress={() => setPicking("status")}
      />
      <Property
        label="Priority"
        icon={<PriorityIcon priority={task.priority} />}
        value={
          <Text className={task.priority ? "" : "text-muted-foreground"}>
            {task.priority ? Task.priorityLabels[task.priority] : "No priority"}
          </Text>
        }
        disabled={disabled}
        onPress={() => setPicking("priority")}
      />
      <Property
        label="Assignee"
        icon={<TaskAssignee task={task} owner={owner} />}
        value={<Text className={assignee ? "" : "text-muted-foreground"}>{assignee ?? "Unassigned"}</Text>}
        disabled={disabled}
        onPress={() => setPicking("assignee")}
      />
      <Property
        label="Due date"
        icon={<Icon as={CalendarDaysIcon} className="size-4 text-muted-foreground" />}
        value={
          <Text className={task.dueAt ? "" : "text-muted-foreground"}>
            {task.dueAt ? longDate.format(new Date(task.dueAt)) : "Set due date"}
          </Text>
        }
        disabled={disabled}
        onPress={() => setPicking("due")}
      />
      <Property
        label="Labels"
        icon={<Icon as={TagIcon} className="size-4 text-muted-foreground" />}
        value={<LabelChips labels={task.labels} />}
        disabled={disabled}
        onPress={() => setPicking("labels")}
      />
      <Property
        label="Space"
        icon={<Icon as={CubeIcon} className="size-4 text-muted-foreground" />}
        value={<Text className="font-medium">{lookups.spaceName(task.spaceId)}</Text>}
        disabled={disabled}
        onPress={() => setPicking("space")}
      />
      <OptionSheet
        open={picking === "status"}
        title="Status"
        options={statusOptions}
        selected={[task.status]}
        onSelect={(status) => {
          if (isStatus(status)) props.onChange({ status })
        }}
        onClose={close}
      />
      <OptionSheet
        open={picking === "priority"}
        title="Priority"
        options={priorityOptions}
        selected={[task.priority ?? "none"]}
        onSelect={(priority) => props.onChange({ priority: isPriority(priority) ? priority : null })}
        onClose={close}
      />
      <AssigneeSheet
        open={picking === "assignee"}
        task={task}
        lookups={lookups}
        onAssign={props.onAssign}
        onClose={close}
      />
      <OptionSheet
        open={picking === "due"}
        title="Due date"
        options={dueOptions(task.dueAt)}
        selected={[]}
        onSelect={(choice) => props.onChange({ dueAt: choice === "clear" ? null : dueAt(choice) })}
        onClose={close}
      />
      {picking === "labels" ? (
        <LabelsSheet task={task} lookups={lookups} onChange={props.onChange} onClose={close} />
      ) : null}
      <OptionSheet
        open={picking === "space"}
        title="Move to a space"
        note="Moving a task does not start work."
        options={lookups.joined.map((space) => ({
          value: space.id,
          label: space.name,
          icon: <Icon as={CubeIcon} className="size-4.5 text-muted-foreground" />,
        }))}
        selected={[task.spaceId]}
        onSelect={(spaceId) => {
          if (spaceId !== task.spaceId) props.onAssign({ spaceId })
        }}
        onClose={close}
      />
    </View>
  )
}

export { TaskProperties, type Assignment }
