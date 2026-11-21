import { useNavigation } from "expo-router"
import { DrawerActions } from "expo-router/react-navigation"
import type { ComponentProps, ReactNode } from "react"
import { Pressable, View } from "react-native"
import Bars3Icon from "react-native-heroicons/outline/Bars3Icon"
import { Icon } from "#components/icon"

function HeaderButton(props: {
  readonly icon: ComponentProps<typeof Icon>["as"]
  readonly label: string
  readonly dot?: boolean
  readonly strokeWidth?: number
  readonly children?: ReactNode
  readonly onPress: () => void
}) {
  return (
    <Pressable
      role="button"
      aria-label={props.label}
      hitSlop={4}
      className="size-10 items-center justify-center rounded-full active:bg-accent"
      onPress={props.onPress}
    >
      {props.children}
      {props.strokeWidth ? (
        <Icon as={props.icon} className="size-6" strokeWidth={props.strokeWidth} />
      ) : (
        <Icon as={props.icon} className="size-5.5" />
      )}
      {props.dot === true ? <View className="absolute top-1.5 right-1.5 size-2 rounded-full bg-ring" /> : null}
    </Pressable>
  )
}

function HeaderActions(props: { readonly children: ReactNode }) {
  return <View className="-me-1.75 flex-row items-center">{props.children}</View>
}

function MenuButton() {
  const navigation = useNavigation()
  return (
    <View className="-ms-1.75">
      <HeaderButton
        icon={Bars3Icon}
        strokeWidth={2}
        label="Open menu"
        onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}
      />
    </View>
  )
}

// oxlint-disable-next-line ren/no-comments -- The same 16pt inset as the native stack header; MenuButton and HeaderActions pull their 40pt buttons out by 7pt so the icons, not the touch targets, sit on the page inset.
const headerOptions = {
  headerShadowVisible: false,
  headerLeftContainerStyle: { paddingStart: 16 },
  headerRightContainerStyle: { paddingEnd: 16 },
} as const

export { HeaderActions, HeaderButton, headerOptions, MenuButton }
