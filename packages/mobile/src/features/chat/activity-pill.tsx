import { useAtomValue } from "@effect/atom-react"
import { ChatState, Family, TimelineText } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { Shell } from "@ren/schema/shell"
import { ErrorText } from "@ren/util/error-text"
import { AsyncResult } from "effect/reactivity"
import { useEffect, useState } from "react"
import { ActivityIndicator, ScrollView, View } from "react-native"
import CommandLineIcon from "react-native-heroicons/mini/CommandLineIcon"
import StopIcon from "react-native-heroicons/mini/StopIcon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Sheet } from "#components/sheet"
import { Text } from "#components/text"

function Row(props: {
  readonly item: Family.Activity
  readonly now: number
  readonly stopping: boolean
  readonly onStop: () => void
}) {
  const item = props.item
  const subagent = item.type === "subagent"
  return (
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-1.5">
      {subagent ? (
        <ActivityIndicator size="small" colorClassName="accent-muted-foreground" />
      ) : (
        <Icon as={CommandLineIcon} className="size-4 text-muted-foreground" />
      )}
      <View className="min-w-0 flex-1">
        {subagent ? (
          <Text className="text-sm font-medium" numberOfLines={1}>
            {item.agent ? Family.agentName(item.agent) : "Agent"}
          </Text>
        ) : null}
        <Text className={subagent ? "text-sm text-muted-foreground" : "font-mono text-xs leading-5"} numberOfLines={1}>
          {item.label}
        </Text>
      </View>
      <Text className="text-xs text-muted-foreground tabular-nums">
        {TimelineText.elapsed(props.now - item.started)}
      </Text>
      {Family.stoppable(item) ? (
        <Button
          variant="outline"
          size="sm"
          aria-label={subagent ? "Interrupt subagent" : "Kill shell command"}
          disabled={props.stopping}
          onPress={props.onStop}
        >
          {props.stopping ? (
            <ActivityIndicator size="small" colorClassName="accent-muted-foreground" />
          ) : (
            <Icon as={StopIcon} className="size-3.5" />
          )}
          <Text className="text-sm">Stop</Text>
        </Button>
      ) : null}
    </View>
  )
}

function Panel(props: {
  readonly items: ReadonlyArray<Family.Activity>
  readonly stopping: ReadonlySet<string>
  readonly error: string
  readonly onStop: (item: Family.Activity) => void
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <>
      <Text className="px-4 pb-2 font-medium">{Family.summary(props.items)}</Text>
      <ScrollView className="grow-0">
        {props.items.map((item) => (
          <Row
            key={item.key}
            item={item}
            now={now}
            stopping={props.stopping.has(item.key)}
            onStop={() => props.onStop(item)}
          />
        ))}
      </ScrollView>
      {props.error ? <Text className="px-4 pt-2 text-sm text-destructive">{props.error}</Text> : null}
    </>
  )
}

function ActivityPill(props: { readonly root: Session.ID }) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(props.root)), () => ChatState.empty)
  const [open, setOpen] = useState(false)
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set())
  const [interrupted, setInterrupted] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState("")
  const stopSession = ChatReact.useAction(props.root, (opened, id: Session.ID) => opened.stop(id))
  const stopShell = ChatReact.useAction(props.root, (opened, sessionID: Session.ID, shellID: Shell.ID) =>
    opened.stopShell(sessionID, shellID),
  )
  const items = Family.activity(state, props.root).filter((item) => !item.sessionID || !interrupted.has(item.sessionID))
  if (items.length === 0 && open) setOpen(false)
  if (items.length === 0) return null
  const stop = (item: Family.Activity) => {
    if (!item.id || !item.sessionID || stopping.has(item.key)) return
    setStopping((current) => new Set([...current, item.key]))
    setError("")
    const sessionID = Session.ID.make(item.sessionID)
    const stopped = item.type === "shell" ? stopShell(sessionID, Shell.ID.make(item.id)) : stopSession(sessionID)
    void stopped.then(
      () => {
        if (item.type === "subagent") setInterrupted((current) => new Set([...current, sessionID]))
      },
      (cause: unknown) => {
        setStopping((current) => new Set([...current].filter((key) => key !== item.key)))
        setError(
          ErrorText.of(
            cause,
            item.type === "shell" ? "Couldn’t stop the command. Try again." : "Couldn’t stop the subagent. Try again.",
          ),
        )
      },
    )
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="mx-3 mb-2 self-start rounded-full bg-card shadow-soft dark:shadow-none"
        aria-label={`${Family.summary(items)}. Show background work`}
        onPress={() => setOpen(true)}
      >
        <ActivityIndicator size="small" colorClassName="accent-muted-foreground" />
        <Text className="text-sm tabular-nums">{Family.summary(items)}</Text>
      </Button>
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false)
          setError("")
        }}
      >
        <Panel items={items} stopping={stopping} error={error} onStop={stop} />
      </Sheet>
    </>
  )
}

export { ActivityPill }
