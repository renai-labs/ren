import { useAtomValue } from "@effect/atom-react"
import { ChatState, Composer } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { ErrorText } from "@ren/util/error-text"
import IconX from "@tabler/icons-react-native/IconX"
import { cn } from "cn"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { Pressable, ScrollView, View } from "react-native"
import ArrowUpIcon from "react-native-heroicons/mini/ArrowUpIcon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Text } from "#components/text"

function QueuedMessages(props: { readonly root: Session.ID }) {
  const state = AsyncResult.getOrElse(useAtomValue(ChatReact.useAtoms().state(props.root)), () => ChatState.empty)
  const cancel = ChatReact.useAction(props.root, (opened, id: SessionMessage.ID) => opened.cancelInput(id))
  const steer = ChatReact.useAction(props.root, (opened, id: SessionMessage.ID) => opened.steerInput(id))
  const [busy, setBusy] = useState<SessionMessage.ID>()
  const [error, setError] = useState("")
  const items = Composer.queued(ChatState.pending(state, props.root))
  if (items.length === 0) return null
  const run = (id: SessionMessage.ID, request: () => Promise<unknown>, fallback: string) => {
    if (busy === id) return
    setBusy(id)
    setError("")
    void request()
      .catch((cause: unknown) => setError(ErrorText.of(cause, fallback)))
      .finally(() => setBusy((current) => (current === id ? undefined : current)))
  }
  return (
    <View className="mx-3 mb-2 rounded-xl border border-border bg-card p-1 shadow-soft dark:shadow-none">
      {items.length > 3 ? (
        <Text className="px-2.5 pt-1 pb-0.5 text-2xs font-medium tracking-wide text-muted-foreground uppercase tabular-nums">
          {items.length} queued
        </Text>
      ) : null}
      <ScrollView aria-label="Queued messages" className="max-h-44 grow-0" nestedScrollEnabled>
        {items.map((item) => (
          <View key={item.id} className="flex-row items-center">
            <Pressable
              role="button"
              aria-label={`Send now: ${item.text}`}
              disabled={busy === item.id}
              className={cn(
                "min-h-11 flex-1 flex-row items-center gap-2 rounded-md pl-2.5 active:bg-muted",
                busy === item.id && "opacity-50",
              )}
              onPress={() => run(item.id, () => steer(item.id), "Couldn’t send the message now. Try again.")}
            >
              <Text className="min-w-0 flex-1 text-sm" numberOfLines={1}>
                {item.text}
              </Text>
              {item.attachments > 0 ? (
                <Text className="text-xs text-muted-foreground">
                  {item.attachments} {item.attachments === 1 ? "file" : "files"}
                </Text>
              ) : null}
              <Icon as={ArrowUpIcon} className="size-4 text-muted-foreground" />
            </Pressable>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="Remove"
              disabled={busy === item.id}
              onPress={() => run(item.id, () => cancel(item.id), "Couldn’t remove the message. Try again.")}
            >
              <Icon as={IconX} className="size-4 text-muted-foreground" />
            </Button>
          </View>
        ))}
      </ScrollView>
      {error ? <Text className="px-2.5 pb-1.5 text-sm text-destructive">{error}</Text> : null}
    </View>
  )
}

export { QueuedMessages }
