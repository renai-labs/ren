import { SessionTitle } from "@ren/chat"
import type { SessionInfo } from "@ren/client"
import { RelativeTime } from "@ren/util/relative-time"
import IconMessage from "@tabler/icons-react-native/IconMessage"
import { ActivityIndicator, Pressable } from "react-native"
import { Icon } from "#components/icon"
import { Text } from "#components/text"

function ChatRow(props: {
  readonly chat: SessionInfo
  readonly active?: boolean
  readonly time?: boolean
  readonly onPress: () => void
}) {
  return (
    <Pressable
      role="link"
      aria-current={props.active === true ? "page" : undefined}
      className={
        props.active === true
          ? "mx-2 flex-row items-center gap-3 rounded-lg bg-accent px-3 py-2.5"
          : "mx-2 flex-row items-center gap-3 rounded-lg px-3 py-2.5 active:bg-accent"
      }
      onPress={props.onPress}
    >
      {props.chat.status === "busy" ? (
        <ActivityIndicator size="small" className="size-4.5" />
      ) : (
        <Icon as={IconMessage} className="size-4.5 text-muted-foreground" />
      )}
      <Text className="flex-1 font-medium" numberOfLines={1}>
        {SessionTitle.display(props.chat.title)}
      </Text>
      {props.time === true ? (
        <Text className="text-sm text-muted-foreground">{RelativeTime.format(props.chat.updatedAt)}</Text>
      ) : null}
    </Pressable>
  )
}

export { ChatRow }
