import { SessionTitle } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { SessionInfo } from "@ren/client"
import { RelativeTime } from "@ren/util/relative-time"
import { cn } from "cn"
import ChatBubbleLeftIcon from "react-native-heroicons/mini/ChatBubbleLeftIcon"
import { Pressable, View } from "react-native"
import { Icon } from "#components/icon"
import { Text } from "#components/text"

function ChatRow(props: {
  readonly chat: SessionInfo
  readonly active?: boolean
  readonly time?: boolean
  readonly onPress: () => void
}) {
  const attention = ChatReact.useAttention(props.chat.id, { busy: props.chat.status === "busy" })
  return (
    <Pressable
      role="link"
      aria-current={props.active === true ? "page" : undefined}
      className={cn(
        "mx-2 flex-row items-center gap-3 rounded-lg px-3 py-2.5",
        props.active === true ? "bg-sidebar-accent" : "active:bg-sidebar-accent",
      )}
      onPress={props.onPress}
    >
      <Icon as={ChatBubbleLeftIcon} className="size-4.5 text-sidebar-foreground/55" />
      <Text className="flex-1 text-sidebar-foreground" numberOfLines={1}>
        {SessionTitle.display(props.chat.title)}
      </Text>
      {attention === "idle" ? null : (
        <View
          className={cn("size-2 rounded-full", attention === "asking" ? "bg-chart-3" : "bg-chart-2")}
          aria-label={attention === "asking" ? "Needs your input" : "Working"}
          role="img"
        />
      )}
      {props.time === true ? (
        <Text className="text-sm text-muted-foreground">{RelativeTime.format(props.chat.updatedAt)}</Text>
      ) : null}
    </Pressable>
  )
}

export { ChatRow }
