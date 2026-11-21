import type { SpaceInfo } from "@ren/client"
import ChevronDownIcon from "react-native-heroicons/mini/ChevronDownIcon"
import CubeIcon from "react-native-heroicons/mini/CubeIcon"
import LockClosedIcon from "react-native-heroicons/mini/LockClosedIcon"
import { cn } from "cn"
import { useState } from "react"
import { Pressable, View } from "react-native"
import { Icon } from "#components/icon"
import { OptionSheet } from "#components/option-sheet"
import { Text } from "#components/text"

const isPersonal = (space: SpaceInfo) => space.kind === "private"

function SpacePicker(props: {
  readonly spaces: ReadonlyArray<SpaceInfo>
  readonly spaceId: string | undefined
  readonly disabled?: boolean
  readonly onChange: (spaceId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const space = props.spaces.find((item) => item.id === props.spaceId)
  const name = space?.name ?? "Choose a space"

  return (
    <>
      <Pressable
        role="button"
        aria-label={`Working in ${name}`}
        disabled={props.disabled}
        className={cn(
          "min-h-11 shrink flex-row items-center gap-2 self-start active:opacity-70",
          props.disabled === true && "opacity-50",
        )}
        onPress={() => setOpen(true)}
      >
        <Text className="text-sm text-muted-foreground">Working in</Text>
        <View className="h-8 shrink flex-row items-center gap-1.5 rounded-full bg-secondary px-3">
          <Icon as={space && isPersonal(space) ? LockClosedIcon : CubeIcon} className="size-4 text-muted-foreground" />
          <Text className="shrink text-sm font-medium" numberOfLines={1}>
            {name}
          </Text>
          <Icon as={ChevronDownIcon} className="size-4 text-muted-foreground" />
        </View>
      </Pressable>
      <OptionSheet
        open={open}
        title="Working in"
        options={[...props.spaces.filter(isPersonal), ...props.spaces.filter((item) => !isPersonal(item))].map(
          (item) => ({
            value: item.id,
            label: item.name,
            group: isPersonal(item) ? "Personal" : "Shared",
            icon: <Icon as={isPersonal(item) ? LockClosedIcon : CubeIcon} className="size-4.5 text-muted-foreground" />,
          }),
        )}
        selected={props.spaceId ? [props.spaceId] : []}
        onSelect={props.onChange}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

export { SpacePicker }
