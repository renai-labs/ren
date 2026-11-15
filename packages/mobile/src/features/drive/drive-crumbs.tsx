import { useRouter } from "expo-router"
import { Fragment, useRef } from "react"
import { Pressable, ScrollView, type ScrollViewInstance } from "react-native"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import { Icon } from "#components/icon"
import { Text } from "#components/text"

function DriveCrumbs(props: {
  readonly space: string | undefined
  readonly spaceName: string | undefined
  readonly folder: string
}) {
  const router = useRouter()
  const scroll = useRef<ScrollViewInstance>(null)
  const parts = props.folder.split("/").filter(Boolean)
  const trail = [
    { key: "drive", label: "Drive", params: {} },
    ...(props.space ? [{ key: props.space, label: props.spaceName ?? "Space", params: { space: props.space } }] : []),
    ...parts.map((part, index) => ({
      key: `${index}:${part}`,
      label: part,
      params: { space: props.space, folder: `${parts.slice(0, index + 1).join("/")}/` },
    })),
  ]
  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      className="grow-0"
      contentContainerClassName="items-center gap-1 px-4 pb-2"
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
    >
      {trail.map((crumb, index) =>
        index === trail.length - 1 ? (
          <Text key={crumb.key} className="text-sm font-medium" numberOfLines={1}>
            {crumb.label}
          </Text>
        ) : (
          <Fragment key={crumb.key}>
            <Pressable
              role="link"
              className="min-h-8 justify-center active:opacity-60"
              onPress={() => router.dismissTo({ pathname: "/drive", params: crumb.params })}
            >
              <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                {crumb.label}
              </Text>
            </Pressable>
            <Icon as={ChevronRightIcon} className="size-3.5 text-muted-foreground/60" />
          </Fragment>
        ),
      )}
    </ScrollView>
  )
}

export { DriveCrumbs }
