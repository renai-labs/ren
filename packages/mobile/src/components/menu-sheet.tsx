import { ErrorText } from "@ren/util/error-text"
import { cn } from "cn"
import { createContext, use, useState, type ComponentProps, type ReactNode } from "react"
import { ActivityIndicator, Pressable, View } from "react-native"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Sheet } from "#components/sheet"
import { Text } from "#components/text"

interface MenuItem {
  readonly label: string
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

function MenuSheet(props: {
  readonly open: boolean
  readonly title: string
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
          {props.items.map((item) => (
            <Pressable
              key={item.label}
              role="menuitem"
              disabled={item.disabled === true || Boolean(pending)}
              className={cn(
                "min-h-12 flex-row items-center gap-3 px-5 active:bg-accent",
                (item.disabled === true || (pending && pending !== item.label)) && "opacity-50",
              )}
              onPress={() => (item.confirm || item.panel ? setChosen(item) : run(item))}
            >
              <Icon
                as={item.icon}
                className={cn("size-5", item.confirm ? "text-destructive" : "text-muted-foreground")}
              />
              <Text className={cn("flex-1", item.confirm && "text-destructive")}>{item.label}</Text>
              {pending === item.label ? <ActivityIndicator size="small" /> : null}
            </Pressable>
          ))}
          {failure ? <Text className="px-5 pt-2 text-sm text-destructive">{failure}</Text> : null}
        </>
      )}
    </Sheet>
  )
}

export { MenuSheet, useMenuSheet, type MenuItem }
