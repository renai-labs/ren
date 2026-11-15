import type { TaskInfo } from "@ren/client"
import { Tasks } from "@ren/client/react"
import { Task } from "@ren/schema/task"
import { ErrorText } from "@ren/util/error-text"
import IconGhostFilled from "@tabler/icons-react-native/IconGhostFilled"
import { useMutation, useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { useState, type ReactNode } from "react"
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native"
import CalendarDaysIcon from "react-native-heroicons/mini/CalendarDaysIcon"
import TagIcon from "react-native-heroicons/mini/TagIcon"
import UserCircleIcon from "react-native-heroicons/mini/UserCircleIcon"
import { TextField } from "#components/input"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { SpacePicker } from "#components/space-picker"
import { Text } from "#components/text"
import {
  dueAt,
  dueOptions,
  formatShortDate,
  isPriority,
  isStatus,
  LabelDot,
  PriorityIcon,
  priorityOptions,
  StatusGlyph,
  statusOptions,
  useTaskLookups,
} from "#features/tasks/task-meta"
import { OptionSheet } from "#components/option-sheet"
import { Api } from "#lib/api"

type Picking = "status" | "priority" | "assignee" | "labels" | "due"

function Chip(props: {
  readonly label: string
  readonly icon: ReactNode
  readonly set: boolean
  readonly onPress: () => void
}) {
  return (
    <Pressable
      role="button"
      aria-label={props.label}
      className="h-9 flex-row items-center gap-1.5 rounded-full border border-border px-3 active:bg-accent"
      onPress={props.onPress}
    >
      {props.icon}
      <Text className={cn("text-sm", props.set ? "text-foreground" : "text-muted-foreground")} numberOfLines={1}>
        {props.label}
      </Text>
    </Pressable>
  )
}

function DraftChips(props: {
  readonly draft: Tasks.Draft
  readonly spaceId: string
  readonly onChange: (patch: Partial<Tasks.Draft>) => void
}) {
  const draft = props.draft
  const set = props.onChange
  const lookups = useTaskLookups([])
  const [picking, setPicking] = useState<Picking>()
  const agents =
    useQuery({
      ...Api.query.agent.list.queryOptions({ spaceId: props.spaceId, isSubagent: false, page: 1, pageSize: 100 }),
      enabled: props.spaceId !== "",
    }).data?.items ?? []
  const agent = agents.find((each) => each.id === draft.agentId)
  const status = isStatus(draft.status) ? draft.status : "todo"
  const priority = isPriority(draft.priority) ? draft.priority : null
  return (
    <>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          label={Task.statusLabels[status]}
          icon={<StatusGlyph status={status} />}
          set
          onPress={() => setPicking("status")}
        />
        <Chip
          label={priority ? Task.priorityLabels[priority] : "Priority"}
          icon={<PriorityIcon priority={priority} />}
          set={Boolean(priority)}
          onPress={() => setPicking("priority")}
        />
        <Chip
          label={agent?.name ?? "Assignee"}
          icon={<Icon as={agent ? IconGhostFilled : UserCircleIcon} className="size-4 text-muted-foreground" />}
          set={Boolean(agent)}
          onPress={() => setPicking("assignee")}
        />
        <Chip
          label={draft.labels.length === 0 ? "Labels" : draft.labels.join(", ")}
          icon={<Icon as={TagIcon} className="size-4 text-muted-foreground" />}
          set={draft.labels.length > 0}
          onPress={() => setPicking("labels")}
        />
        <Chip
          label={draft.dueAt ? formatShortDate(draft.dueAt) : "Due date"}
          icon={<Icon as={CalendarDaysIcon} className="size-4 text-muted-foreground" />}
          set={draft.dueAt !== ""}
          onPress={() => setPicking("due")}
        />
      </View>
      <OptionSheet
        open={picking === "status"}
        title="Status"
        options={statusOptions}
        selected={[draft.status]}
        onSelect={(value) => set({ status: value })}
        onClose={() => setPicking(undefined)}
      />
      <OptionSheet
        open={picking === "priority"}
        title="Priority"
        options={priorityOptions}
        selected={[draft.priority]}
        onSelect={(value) => set({ priority: value })}
        onClose={() => setPicking(undefined)}
      />
      <OptionSheet
        open={picking === "assignee"}
        title="Assignee"
        options={[
          {
            value: "none",
            label: "No assignee",
            icon: <Icon as={UserCircleIcon} className="size-4.5 text-muted-foreground" />,
          },
          ...agents.map((each) => ({
            value: each.id,
            label: each.name,
            icon: <Icon as={IconGhostFilled} className="size-4.5 text-muted-foreground" />,
          })),
        ]}
        selected={[draft.agentId]}
        onSelect={(agentId) => set({ agentId })}
        onClose={() => setPicking(undefined)}
      />
      <OptionSheet
        open={picking === "labels"}
        title="Labels"
        multiple
        options={lookups.labels.map((label) => ({
          value: label.name,
          label: label.name,
          icon: <LabelDot color={label.color} />,
        }))}
        selected={draft.labels}
        onSelect={(name) =>
          set({
            labels: draft.labels.includes(name)
              ? draft.labels.filter((each) => each !== name)
              : [...draft.labels, name],
          })
        }
        onClose={() => setPicking(undefined)}
      />
      <OptionSheet
        open={picking === "due"}
        title="Due date"
        options={dueOptions(draft.dueAt || null)}
        selected={[]}
        onSelect={(choice) => set({ dueAt: choice === "clear" ? "" : dueAt(choice) })}
        onClose={() => setPicking(undefined)}
      />
    </>
  )
}

function NewTask(props: {
  readonly open: boolean
  readonly spaceId?: string
  readonly parent?: { readonly id: string; readonly identifier: string }
  readonly onClose: () => void
  readonly onCreated?: (task: TaskInfo) => void
}) {
  const lookups = useTaskLookups([])
  const fallback = props.spaceId ?? lookups.joined.at(0)?.id ?? ""
  const [draft, setDraft] = useState(() => Tasks.draft(fallback))
  const [error, setError] = useState("")
  const spaceId = draft.spaceId || fallback
  const set = (patch: Partial<Tasks.Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const create = useMutation(Api.query.task.create.mutationOptions())
  const close = () => {
    setDraft(Tasks.draft(fallback))
    setError("")
    props.onClose()
  }
  const submit = () => {
    if (!draft.title.trim() || !spaceId || create.isPending) return
    setError("")
    create.mutate(Tasks.createInput(draft, spaceId, props.parent?.id), {
      onSuccess: (task) => {
        close()
        props.onCreated?.(task)
      },
      onError: (cause) => setError(ErrorText.of(cause, "Couldn’t create the task. Try again.")),
    })
  }
  const ready = draft.title.trim() !== "" && spaceId !== "" && !create.isPending
  return (
    <Modal
      visible={props.open}
      animationType="slide"
      presentationStyle="pageSheet"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View className="flex-1 bg-background android:pt-safe">
        <View className="h-14 flex-row items-center justify-between px-2">
          <Button variant="ghost" size="sm" onPress={close}>
            <Text>Cancel</Text>
          </Button>
          <Text role="heading" aria-level={1} className="font-semibold">
            {props.parent ? `New sub-task of ${props.parent.identifier}` : "New task"}
          </Text>
          <Button variant="ghost" size="sm" disabled={!ready} aria-disabled={!ready} onPress={submit}>
            {create.isPending ? <ActivityIndicator size="small" /> : null}
            <Text className="text-primary">Create</Text>
          </Button>
        </View>
        {error ? <Text className="px-5 pb-2 text-sm text-destructive">{error}</Text> : null}
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3 px-5 pb-safe-offset-6">
          {props.parent || lookups.joined.length === 0 ? null : (
            <SpacePicker
              spaces={lookups.joined}
              spaceId={spaceId}
              onChange={(next) => set({ spaceId: next, agentId: "none" })}
            />
          )}
          <TextField
            className="py-1 text-xl font-medium"
            value={draft.title}
            onChangeText={(title) => set({ title })}
            placeholder="Task title"
            aria-label="Task title"
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the screen opens to take a title
            autoFocus
            maxLength={Task.maximumTitleLength}
            returnKeyType="next"
            submitBehavior="blurAndSubmit"
          />
          <TextField
            className="min-h-32 py-1 text-base"
            value={draft.description}
            onChangeText={(description) => set({ description })}
            placeholder="Add description…"
            aria-label="Task description"
            multiline
            textAlignVertical="top"
          />
          <DraftChips draft={draft} spaceId={spaceId} onChange={set} />
        </ScrollView>
      </View>
    </Modal>
  )
}

export { NewTask }
