import { useState, type ComponentProps, type ReactNode } from "react"
import { Pressable, ScrollView, View } from "react-native"
import CheckIcon from "react-native-heroicons/mini/CheckIcon"
import MagnifyingGlassIcon from "react-native-heroicons/mini/MagnifyingGlassIcon"
import PlusIcon from "react-native-heroicons/mini/PlusIcon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { Input } from "#components/input"
import { Sheet } from "#components/sheet"
import { Text } from "#components/text"

interface Option {
  readonly value: string
  readonly label: string
  readonly icon?: ReactNode
  readonly group?: string
}

function OptionRow(props: {
  readonly option: Option
  readonly checked: boolean
  readonly multiple: boolean
  readonly onPress: () => void
}) {
  return (
    <Pressable
      role={props.multiple ? "checkbox" : "radio"}
      aria-checked={props.checked}
      className="min-h-11 flex-row items-center gap-3 px-5 active:bg-accent"
      onPress={props.onPress}
    >
      {props.option.icon ? <View className="size-5 items-center justify-center">{props.option.icon}</View> : null}
      <Text className="flex-1" numberOfLines={1}>
        {props.option.label}
      </Text>
      {props.checked ? <Icon as={CheckIcon} className="size-4.5" /> : null}
    </Pressable>
  )
}

function OptionList(props: {
  readonly options: ReadonlyArray<Option>
  readonly selected: ReadonlyArray<string>
  readonly multiple?: boolean
  readonly searchable?: boolean
  readonly note?: string
  readonly onSelect: (value: string) => void
  readonly onCreate?: (name: string) => void
}) {
  const [query, setQuery] = useState("")
  const typed = query.trim()
  const needle = typed.toLowerCase()
  const matches = props.options.filter((option) => option.label.toLowerCase().includes(needle))
  const creatable =
    Boolean(props.onCreate) && typed !== "" && !props.options.some((option) => option.label.toLowerCase() === needle)
  const groups = [...new Set(matches.map((option) => option.group))]
  return (
    <>
      {props.searchable === true || props.options.length > 6 ? (
        <View className="mx-5 mb-2 justify-center">
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={props.onCreate ? "Search or create…" : "Search…"}
            aria-label="Search"
            autoCorrect={false}
            autoCapitalize="none"
            className="pl-9"
          />
          <Icon as={MagnifyingGlassIcon} className="absolute left-3 size-4 text-muted-foreground" />
        </View>
      ) : null}
      {props.note ? <Text className="px-5 pb-2 text-sm text-muted-foreground">{props.note}</Text> : null}
      <ScrollView keyboardShouldPersistTaps="handled" role={props.multiple === true ? undefined : "radiogroup"}>
        {matches.length === 0 && !creatable ? (
          <Text className="px-5 py-6 text-center text-sm text-muted-foreground">No results</Text>
        ) : null}
        {groups.map((group) => (
          <View key={group ?? ""}>
            {group ? <Text className="px-5 pt-3 pb-1 text-sm text-muted-foreground">{group}</Text> : null}
            {matches
              .filter((option) => option.group === group)
              .map((option) => (
                <OptionRow
                  key={option.value}
                  option={option}
                  checked={props.selected.includes(option.value)}
                  multiple={props.multiple === true}
                  onPress={() => props.onSelect(option.value)}
                />
              ))}
          </View>
        ))}
        {creatable ? (
          <Pressable
            role="button"
            className="min-h-11 flex-row items-center gap-3 px-5 active:bg-accent"
            onPress={() => {
              props.onCreate?.(typed)
              setQuery("")
            }}
          >
            <Icon as={PlusIcon} className="size-5 text-muted-foreground" />
            <Text className="flex-1" numberOfLines={1}>
              Create “{typed}”
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </>
  )
}

function SheetTitle(props: { readonly children: ReactNode }) {
  return (
    <Text role="heading" aria-level={2} className="px-5 pb-2 text-base font-semibold">
      {props.children}
    </Text>
  )
}

function OptionSheet(
  props: ComponentProps<typeof OptionList> & {
    readonly open: boolean
    readonly title: string
    readonly onClose: () => void
  },
) {
  const multiple = props.multiple === true
  return (
    <Sheet open={props.open} onClose={props.onClose}>
      <SheetTitle>{props.title}</SheetTitle>
      <OptionList
        {...props}
        onSelect={(value) => {
          props.onSelect(value)
          if (!multiple) props.onClose()
        }}
      />
      {multiple ? (
        <View className="px-5 pt-2">
          <Button variant="secondary" onPress={props.onClose}>
            <Text>Done</Text>
          </Button>
        </View>
      ) : null}
    </Sheet>
  )
}

export { OptionList, OptionSheet, SheetTitle, type Option }
