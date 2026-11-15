import type { ReactNode } from "react"
import { Pressable, View } from "react-native"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import EllipsisHorizontalIcon from "react-native-heroicons/mini/EllipsisHorizontalIcon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Text } from "#components/text"

function DriveRow(props: {
  readonly media: ReactNode
  readonly title: string
  readonly subtitle?: string | undefined
  readonly meta?: string | undefined
  readonly badge?: ReactNode
  readonly onPress: () => void
  readonly onMenu?: (() => void) | undefined
}) {
  return (
    <Pressable
      role="link"
      className="min-h-14 flex-row items-center gap-3 pl-4 active:bg-accent"
      onPress={props.onPress}
      onLongPress={props.onMenu}
    >
      <View className="w-6 items-center">{props.media}</View>
      <View className="flex-1 py-2">
        <View className="flex-row items-center gap-2">
          <Text className="shrink" numberOfLines={1}>
            {props.title}
          </Text>
          {props.badge}
        </View>
        {props.subtitle ? (
          <Text className="text-sm text-muted-foreground" numberOfLines={1}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      {props.meta ? <Text className="text-sm text-muted-foreground tabular-nums">{props.meta}</Text> : null}
      {props.onMenu ? (
        <Button variant="ghost" size="icon" aria-label={`${props.title} actions`} onPress={props.onMenu}>
          <Icon as={EllipsisHorizontalIcon} className="size-5 text-muted-foreground" />
        </Button>
      ) : (
        <Icon as={ChevronRightIcon} className="mr-4 size-5 text-muted-foreground/60" />
      )}
    </Pressable>
  )
}

export { DriveRow }
