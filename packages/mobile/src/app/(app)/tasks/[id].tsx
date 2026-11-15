import type { TaskInfo } from "@ren/client"
import { Seed, Tasks } from "@ren/client/react"
import { TaskLink } from "@ren/schema/task-link"
import { ErrorText } from "@ren/util/error-text"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Stack, useLocalSearchParams, useRouter } from "expo-router"
import { openBrowserAsync } from "expo-web-browser"
import { useState } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import ArchiveBoxIcon from "react-native-heroicons/mini/ArchiveBoxIcon"
import ArrowUpLeftIcon from "react-native-heroicons/mini/ArrowUpLeftIcon"
import ChatBubbleLeftIcon from "react-native-heroicons/mini/ChatBubbleLeftIcon"
import CheckCircleIcon from "react-native-heroicons/mini/CheckCircleIcon"
import CheckIcon from "react-native-heroicons/mini/CheckIcon"
import ChevronDownIcon from "react-native-heroicons/mini/ChevronDownIcon"
import ClipboardDocumentCheckIcon from "react-native-heroicons/mini/ClipboardDocumentCheckIcon"
import ClockIcon from "react-native-heroicons/mini/ClockIcon"
import EllipsisHorizontalIcon from "react-native-heroicons/mini/EllipsisHorizontalIcon"
import GlobeAltIcon from "react-native-heroicons/mini/GlobeAltIcon"
import HandRaisedIcon from "react-native-heroicons/mini/HandRaisedIcon"
import PlayIcon from "react-native-heroicons/mini/PlayIcon"
import PlusIcon from "react-native-heroicons/mini/PlusIcon"
import UserCircleIcon from "react-native-heroicons/mini/UserCircleIcon"
import XCircleIcon from "react-native-heroicons/mini/XCircleIcon"
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller"
import { withUniwind } from "uniwind"
import { TextField } from "#components/input"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Markdown } from "#components/markdown"
import { Text } from "#components/text"
import { PromptInput } from "#features/chat/prompt-input"
import { TaskActivity } from "#features/tasks/task-activity"
import { failed, PriorityIcon, StatusGlyph, useTaskLookups } from "#features/tasks/task-meta"
import { NewTask } from "#features/tasks/task-new"
import { MenuSheet } from "#components/menu-sheet"
import { TaskProperties, type Assignment } from "#features/tasks/task-properties"
import { Api } from "#lib/api"

const StickyView = withUniwind(KeyboardStickyView)

export default function TaskRoute() {
  const id = useLocalSearchParams<{ id: string }>().id
  return <TaskDetail key={id} id={id} />
}

function TaskDetail(props: { readonly id: string }) {
  const queryClient = useQueryClient()
  const stored = useQuery({
    ...Api.query.task.get.queryOptions({ idOrSlug: props.id }),
    refetchInterval: Tasks.refreshEvery,
    ...Seed.fromList<TaskInfo>(queryClient, [Api.query.task.list.queryKey(), Tasks.allKey()], props.id),
  })
  if (stored.data) return <TaskBody stored={stored.data} />
  if (stored.isError)
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background p-6">
        <Text className="text-center text-muted-foreground">
          {ErrorText.of(stored.error, "Couldn’t load this task.")}
        </Text>
        <Button variant="outline" onPress={() => void stored.refetch()}>
          <Text>Try again</Text>
        </Button>
      </View>
    )
  return (
    <View className="flex-1 items-center justify-center bg-background p-6">
      {stored.fetchStatus === "paused" ? (
        <Text className="text-center text-muted-foreground">You’re offline. The task loads when you reconnect.</Text>
      ) : (
        <ActivityIndicator />
      )}
    </View>
  )
}

function TaskBody(props: { readonly stored: TaskInfo }) {
  const router = useRouter()
  const update = useMutation(Api.query.task.update.mutationOptions())
  const assign = useMutation(Api.query.task.assign.mutationOptions())
  const archive = useMutation(Api.query.task.archive.mutationOptions())
  const start = useMutation(Api.query.task.start.mutationOptions())
  const review = useMutation(Api.query.task.review.mutationOptions())
  const comment = useMutation(Api.query["task-comment"].create.mutationOptions())
  const task = Tasks.withPatch(props.stored, update.isPending ? update.variables : undefined)
  const lookups = useTaskLookups([task.spaceId])
  const [menu, setMenu] = useState<"start" | "actions">()
  const [adding, setAdding] = useState(false)
  const [body, setBody] = useState("")
  const change = (patch: Tasks.Patch) =>
    update.mutate({ id: task.id, ...patch }, { onError: failed("Couldn’t save the task") })
  const reassign = (target: Assignment) =>
    assign.mutate({ id: task.id, start: "none", ...target }, { onError: failed("Couldn’t reassign the task") })
  const openSession = (sessionId: string) => router.push({ pathname: "/chat/[id]", params: { id: sessionId } })
  const startSession = (mode: "new" | "continue") =>
    start.mutate(
      { id: task.id, mode },
      {
        onSuccess: (started) => {
          if (started.session) openSession(started.session.id)
        },
        onError: failed("Couldn’t start the task"),
      },
    )
  const send = () => {
    const text = body.trim()
    if (!text || comment.isPending) return
    comment.mutate(
      { taskId: task.id, body: text },
      { onSuccess: () => setBody(""), onError: failed("Couldn’t post the comment") },
    )
  }
  const session = task.session
  const waiting = lookups.agent(task.agentId)?.name ?? "Ren"
  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: task.identifier,
          headerRight: () => (
            <View className="flex-row items-center gap-1">
              <Button
                size="sm"
                className="h-8 rounded-full"
                aria-label={`Start a session for ${task.title}`}
                disabled={start.isPending}
                onPress={() => setMenu("start")}
              >
                {start.isPending ? <ActivityIndicator size="small" /> : <Icon as={PlayIcon} className="size-4" />}
                <Text className="text-sm">Start</Text>
                <Icon as={ChevronDownIcon} className="size-3.5" />
              </Button>
              <Pressable
                role="button"
                aria-label={`Actions for ${task.title}`}
                hitSlop={6}
                className="size-9 items-center justify-center rounded-full active:bg-accent"
                onPress={() => setMenu("actions")}
              >
                <Icon as={EllipsisHorizontalIcon} className="size-5" />
              </Pressable>
            </View>
          ),
        }}
      />
      <KeyboardAwareScrollView bottomOffset={96} keyboardShouldPersistTaps="handled">
        <View className="gap-5 px-5 pt-2 pb-36">
          {task.parent ? (
            <Pressable
              role="link"
              aria-label={`Back to ${task.parent.identifier}`}
              className="h-7 flex-row items-center gap-1.5 self-start rounded-full border border-border bg-muted px-2.5 active:opacity-70"
              onPress={() => task.parent && router.push({ pathname: "/tasks/[id]", params: { id: task.parent.id } })}
            >
              <Icon as={ArrowUpLeftIcon} className="size-3.5 text-muted-foreground" />
              <Icon as={ClipboardDocumentCheckIcon} className="size-3.5 text-muted-foreground" />
              <Text className="shrink text-xs font-medium" numberOfLines={1}>
                {task.parent.title}
              </Text>
            </Pressable>
          ) : null}
          <TextField
            key={`title-${task.title}`}
            className="text-2xl font-semibold"
            defaultValue={task.title}
            editable={task.canUpdate}
            aria-label="Task title"
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="done"
            onEndEditing={(event) => {
              const title = event.nativeEvent.text.trim()
              if (title && title !== task.title) change({ title })
            }}
          />
          {task.humanReview ? (
            <View className="gap-3 rounded-xl border border-border bg-card p-4">
              <View className="flex-row gap-3">
                <Icon as={HandRaisedIcon} className="mt-0.5 size-4 text-chart-3" />
                <View className="flex-1 gap-1">
                  <Text className="font-medium">{waiting} is waiting for your go-ahead</Text>
                  {task.humanReviewReason ? (
                    <Text className="text-sm text-muted-foreground">{task.humanReviewReason}</Text>
                  ) : null}
                </View>
              </View>
              <View className="flex-row justify-end gap-2">
                {session ? (
                  <Button variant="ghost" size="sm" onPress={() => openSession(session.id)}>
                    <Text>Details</Text>
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  disabled={review.isPending}
                  onPress={() =>
                    review.mutate(
                      { id: task.id, payload: { humanReview: false, decision: "approved" } },
                      { onError: failed("Couldn’t send the review") },
                    )
                  }
                >
                  <Icon as={CheckIcon} className="size-4" />
                  <Text>Approve</Text>
                </Button>
              </View>
            </View>
          ) : null}
          <TaskProperties task={task} lookups={lookups} onChange={change} onAssign={reassign} />
          {task.links.length > 0 ? (
            <View className="flex-row flex-wrap gap-1.5">
              {task.links.map((link) => (
                <Pressable
                  key={link.id}
                  role="link"
                  aria-label={link.url}
                  className="h-7 max-w-full flex-row items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 active:opacity-70"
                  onPress={() => void openBrowserAsync(link.url)}
                >
                  <Icon as={GlobeAltIcon} className="size-3.5 text-muted-foreground" />
                  <Text className="shrink text-sm" numberOfLines={1}>
                    {TaskLink.label(link)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Description task={task} onChange={(description) => change({ description })} />
          <Subtasks task={task} onAdd={() => setAdding(true)} />
          <TaskActivity taskId={task.id} lookups={lookups} onOpenSession={openSession} />
        </View>
      </KeyboardAwareScrollView>
      <StickyView className="absolute inset-x-0 bottom-0">
        <View className="pb-safe-offset-6">
          <PromptInput
            value={body}
            onChange={setBody}
            onSend={send}
            onStop={send}
            running={false}
            placeholder="Leave a comment…"
          />
        </View>
      </StickyView>
      <MenuSheet
        open={menu === "start"}
        title={`Start ${task.identifier}`}
        onClose={() => setMenu(undefined)}
        items={[
          { label: "Start new session", icon: PlusIcon, onPress: () => startSession("new") },
          {
            label: "Continue last session",
            icon: ClockIcon,
            disabled: !session,
            onPress: () => startSession("continue"),
          },
          ...(session
            ? [{ label: "Open session", icon: ChatBubbleLeftIcon, onPress: () => openSession(session.id) }]
            : []),
        ]}
      />
      <MenuSheet
        open={menu === "actions"}
        title={`${task.identifier} · ${task.title}`}
        onClose={() => setMenu(undefined)}
        items={[
          { label: "Mark done", icon: CheckCircleIcon, onPress: () => change({ status: "done" }) },
          { label: "Dismiss", icon: XCircleIcon, onPress: () => change({ status: "dismissed" }) },
          {
            label: "Unassign",
            icon: UserCircleIcon,
            disabled: !task.agentId,
            onPress: () => reassign({ agentId: null }),
          },
          {
            label: "Request review",
            icon: HandRaisedIcon,
            disabled: task.humanReview,
            onPress: () =>
              review.mutate(
                { id: task.id, payload: { humanReview: true, reason: "Requested from the task page" } },
                { onError: failed("Couldn’t request a review") },
              ),
          },
          {
            label: "Archive task",
            icon: ArchiveBoxIcon,
            onPress: () =>
              archive.mutate(
                { id: task.id },
                { onSuccess: () => router.back(), onError: failed("Couldn’t archive the task") },
              ),
            confirm: {
              title: "Archive this task?",
              description: "It leaves the task list. Its chats stay.",
              action: "Archive",
            },
          },
        ]}
      />
      <NewTask
        open={adding}
        spaceId={task.spaceId}
        parent={{ id: task.id, identifier: task.identifier }}
        onClose={() => setAdding(false)}
      />
    </View>
  )
}

function Description(props: { readonly task: TaskInfo; readonly onChange: (description: string | null) => void }) {
  const description = props.task.description ?? ""
  const [draft, setDraft] = useState<string>()
  // ast-grep-ignore: no-nullish-comparison, -- an empty draft is still an open editor
  if (draft !== undefined)
    return (
      <View className="gap-2">
        <TextField
          className="min-h-32 rounded-lg border border-input bg-card p-3 text-base"
          value={draft}
          onChangeText={setDraft}
          placeholder="Add description…"
          aria-label="Task description"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field opens because the person asked to edit
          autoFocus
          multiline
          textAlignVertical="top"
        />
        <View className="flex-row justify-end gap-2">
          <Button variant="ghost" size="sm" onPress={() => setDraft(undefined)}>
            <Text>Cancel</Text>
          </Button>
          <Button
            size="sm"
            onPress={() => {
              if (draft.trim() !== description.trim()) props.onChange(draft.trim() || null)
              setDraft(undefined)
            }}
          >
            <Text>Save</Text>
          </Button>
        </View>
      </View>
    )
  if (!description && !props.task.canUpdate) return null
  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm text-muted-foreground">Description</Text>
        {props.task.canUpdate ? (
          <Button variant="ghost" size="sm" className="h-8" onPress={() => setDraft(description)}>
            <Text className="text-sm text-muted-foreground">Edit</Text>
          </Button>
        ) : null}
      </View>
      {description ? (
        <Markdown text={description} />
      ) : (
        <Pressable role="button" onPress={() => setDraft("")}>
          <Text className="text-muted-foreground">Add description…</Text>
        </Pressable>
      )}
    </View>
  )
}

function Subtasks(props: { readonly task: TaskInfo; readonly onAdd: () => void }) {
  const router = useRouter()
  const task = props.task
  const listed = useQuery({
    ...Api.query.task.list.queryOptions({ parentId: task.id, includeDone: true, page: 1, pageSize: 100 }),
    refetchInterval: Tasks.refreshEvery,
  })
  const total = task.subtasks?.total ?? 0
  return (
    <View className="gap-1">
      <View className="h-9 flex-row items-center justify-between">
        <Text className="font-medium">
          Sub-tasks
          {total > 0 ? (
            <Text className="text-muted-foreground tabular-nums">
              {"  "}
              {task.subtasks?.done ?? 0}/{total}
            </Text>
          ) : null}
        </Text>
        {task.canUpdate ? (
          <Button variant="ghost" size="icon" className="size-9" aria-label="Add sub-task" onPress={props.onAdd}>
            <Icon as={PlusIcon} className="size-5 text-muted-foreground" />
          </Button>
        ) : null}
      </View>
      {listed.isPending && total > 0 ? <ActivityIndicator className="self-start" /> : null}
      {(listed.data?.items ?? []).map((subtask) => (
        <Pressable
          key={subtask.id}
          role="link"
          className="-mx-2 min-h-11 flex-row items-center gap-2 rounded-lg px-2 active:bg-accent"
          onPress={() => router.push({ pathname: "/tasks/[id]", params: { id: subtask.id } })}
        >
          <PriorityIcon priority={subtask.priority} />
          <Text className="text-xs text-muted-foreground tabular-nums">{subtask.identifier}</Text>
          <StatusGlyph status={subtask.status} />
          <Text className="flex-1 font-medium" numberOfLines={1}>
            {subtask.title}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}
