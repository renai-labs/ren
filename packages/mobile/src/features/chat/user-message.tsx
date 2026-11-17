import { type ChatState, Composer } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import { cn } from "cn"
import { useState } from "react"
import { Pressable, View } from "react-native"
import ChevronDownIcon from "react-native-heroicons/mini/ChevronDownIcon"
import ChevronUpIcon from "react-native-heroicons/mini/ChevronUpIcon"
import { Button } from "#components/button"
import { useCopy } from "#components/copy-button"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import { DriveFileCards } from "#features/chat/attachments"

const foldAbove = 20

const statusLabels: Partial<Record<ChatState.PendingStatus, string>> = {
  starting: "Pending",
  steering: "Pending",
  stranded: "Pending",
  unreachable: "Can’t reach Ren. Trying again…",
  unsent: "Not sent",
}

function Bubble(props: { readonly message: SessionMessage.User; readonly fold: boolean; readonly onCopy: () => void }) {
  const message = props.message
  const text = message.presentation?.displayText ?? message.text
  const [tall, setTall] = useState(() => text.split("\n").length > foldAbove)
  const [open, setOpen] = useState(false)
  const long = props.fold && !message.schedule && !message.webhook && !message.channel && tall
  return (
    <Pressable
      className="rounded-xl rounded-tr-md bg-muted px-4 py-2 dark:bg-secondary"
      onLongPress={props.onCopy}
      accessibilityHint="Long-press to copy"
    >
      <Text
        selectable
        className="text-md leading-6"
        numberOfLines={long && !open ? 12 : undefined}
        onTextLayout={(event) => {
          if (event.nativeEvent.lines.length > foldAbove) setTall(true)
        }}
      >
        {text}
      </Text>
      {long ? (
        <Pressable
          role="button"
          aria-expanded={open}
          hitSlop={8}
          className="flex-row items-center gap-1 self-start pt-1"
          onPress={() => setOpen(!open)}
        >
          <Text className="text-sm text-muted-foreground">{open ? "Show less" : "Read more"}</Text>
          <Icon as={open ? ChevronUpIcon : ChevronDownIcon} className="size-4 text-muted-foreground" />
        </Pressable>
      ) : null}
    </Pressable>
  )
}

function UserMessage(props: {
  readonly message: SessionMessage.User
  readonly status: ChatState.PendingStatus | undefined
  readonly fold: boolean
  readonly spaceId: string | undefined
  readonly onRetry: () => void
  readonly onRemove: () => void
}) {
  const clipboard = useCopy()
  const message = props.message
  const label = props.status && statusLabels[props.status]
  const unsent = props.status === "unsent"
  return (
    <View className="max-w-5/6 gap-1 self-end">
      <DriveFileCards spaceId={props.spaceId} files={message.uploads ?? []} className="justify-end" />
      <Bubble message={message} fold={props.fold} onCopy={() => clipboard.copy(Composer.copyText(message))} />
      {label || clipboard.copied ? (
        <View className="flex-row items-center justify-end gap-1">
          {clipboard.copied ? <Text className="px-1 text-xs text-muted-foreground">Copied</Text> : null}
          {label ? (
            <Text className={cn("px-1 text-xs", unsent ? "text-destructive" : "text-muted-foreground")}>{label}</Text>
          ) : null}
          {unsent ? (
            <>
              <Button variant="ghost" size="sm" className="h-7 px-2" onPress={props.onRetry}>
                <Text className="text-sm text-muted-foreground">Retry</Text>
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2" onPress={props.onRemove}>
                <Text className="text-sm text-muted-foreground">Remove</Text>
              </Button>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

export { UserMessage }
