import { ErrorText } from "@ren/util/error-text"
import { cn } from "cn"
import { createContext, use, useState, type ComponentProps, type ReactNode } from "react"
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Sheet } from "#components/sheet"
import { Text } from "#components/text"

interface MenuItem {
  readonly key?: string
  readonly group?: string
  readonly label: string
  readonly detail?: string
  readonly icon: ComponentProps<typeof Icon>["as"]
  readonly onPress?: () => unknown
  readonly disabled?: boolean
  readonly confirm?: { readonly title: string; readonly description: string; readonly action: string }
  readonly panel?: ReactNode
}

const MenuSheetContext = createContext<{ readonly close: () => void }>({ close: () => undefined })

function useMenuSheet() {
  return use(MenuSheetContext)
}

function GroupStart(props: { readonly group: string | undefined; readonly previous: MenuItem | undefined }) {
  if (props.previous && props.group === props.previous.group) return null
  return (
    <>
      {props.previous ? <View className="my-1 h-px bg-border" /> : null}
      {props.group ? (
        <Text className="px-5 pt-2 pb-1 text-xs font-medium text-muted-foreground">{props.group}</Text>
      ) : null}
    </>
  )
}

function MenuRow(props: {
  readonly item: MenuItem
  readonly previous: MenuItem | undefined
  readonly pending: string | undefined
  readonly onPress: () => void
}) {
  const item = props.item
  const muted = item.disabled === true || (Boolean(props.pending) && props.pending !== item.label)
  return (
    <View>
      <GroupStart group={item.group} previous={props.previous} />
      <Pressable
        role="menuitem"
        disabled={item.disabled === true || Boolean(props.pending)}
        className={cn("min-h-12 flex-row items-center gap-3 px-5 active:bg-accent", muted && "opacity-50")}
        onPress={props.onPress}
      >
        <Icon as={item.icon} className={cn("size-5", item.confirm ? "text-destructive" : "text-muted-foreground")} />
        <Text className={cn("flex-1", item.confirm && "text-destructive")} numberOfLines={1}>
          {item.label}
        </Text>
        {item.detail ? <Text className="text-sm text-muted-foreground">{item.detail}</Text> : null}
        {props.pending === item.label ? <ActivityIndicator size="small" /> : null}
      </Pressable>
    </View>
  )
}

function MenuSheet(props: {
  readonly open: boolean
  readonly title: string
  readonly header?: ReactNode
  readonly items: ReadonlyArray<MenuItem>
  readonly onClose: () => void
}) {
  const [chosen, setChosen] = useState<MenuItem>()
  const [pending, setPending] = useState<string>()
  const [failure, setFailure] = useState<string>()
  const close = () => {
    setChosen(undefined)
    setPending(undefined)
    setFailure(undefined)
    props.onClose()
  }
  const run = (item: MenuItem) => {
    if (!item.onPress) return close()
    setFailure(undefined)
    setPending(item.label)
    void Promise.resolve(item.onPress()).then(close, (error: unknown) => {
      setPending(undefined)
      setFailure(ErrorText.of(error))
    })
  }
  return (
    <Sheet open={props.open} onClose={pending ? () => undefined : close}>
      <MenuSheetContext value={{ close }}>{chosen?.panel ?? null}</MenuSheetContext>
      {chosen?.confirm ? (
        <View className="gap-2 px-5">
          <Text role="heading" aria-level={2} className="text-base font-semibold">
            {chosen.confirm.title}
          </Text>
          <Text className="text-muted-foreground">{chosen.confirm.description}</Text>
          {failure ? <Text className="text-sm text-destructive">{failure}</Text> : null}
          <View className="flex-row gap-2 pt-3">
            <Button
              variant="secondary"
              className="flex-1"
              disabled={Boolean(pending)}
              onPress={() => setChosen(undefined)}
            >
              <Text>Cancel</Text>
            </Button>
            <Button variant="destructive" className="flex-1" disabled={Boolean(pending)} onPress={() => run(chosen)}>
              {pending ? <ActivityIndicator size="small" /> : null}
              <Text>{chosen.confirm.action}</Text>
            </Button>
          </View>
        </View>
      ) : null}
      {chosen ? null : (
        <>
          <Text className="px-5 pb-2 text-sm text-muted-foreground" numberOfLines={1}>
            {props.title}
          </Text>
          {props.header}
          <ScrollView>
            {props.items.map((item, index) => (
              <MenuRow
                key={item.key ?? item.label}
                item={item}
                previous={props.items[index - 1]}
                pending={pending}
                onPress={() => (item.confirm || item.panel ? setChosen(item) : run(item))}
              />
            ))}
          </ScrollView>
          {failure ? <Text className="px-5 pt-2 text-sm text-destructive">{failure}</Text> : null}
        </>
      )}
    </Sheet>
  )
}

export { MenuSheet, useMenuSheet, type MenuItem }
