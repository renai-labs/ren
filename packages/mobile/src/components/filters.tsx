import IconX from "@tabler/icons-react-native/IconX"
import { cn } from "cn"
import { Pressable, ScrollView, View } from "react-native"
import ChevronLeftIcon from "react-native-heroicons/mini/ChevronLeftIcon"
import ChevronRightIcon from "react-native-heroicons/mini/ChevronRightIcon"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { OptionList, type Option } from "#components/option-sheet"
import { Text } from "#components/text"

interface FilterProperty {
  readonly key: string
  readonly label: string
  readonly any: string
  readonly single?: boolean
  readonly options: ReadonlyArray<Option>
}

type Filters = Readonly<Record<string, ReadonlyArray<string>>>

const summary = (property: FilterProperty, selected: ReadonlyArray<string>) => {
  if (selected.length === 0) return property.any
  if (selected.length > 1) return `${selected.length} selected`
  return property.options.find((option) => option.value === selected.at(0))?.label ?? selected.at(0)
}

const isFiltered = (filters: Filters) => Object.values(filters).some((values) => values.length > 0)

function FilterChips(props: {
  readonly properties: ReadonlyArray<FilterProperty>
  readonly filters: Filters
  readonly onChange: (filters: Filters) => void
}) {
  const on = props.properties.filter((property) => (props.filters[property.key] ?? []).length > 0)
  if (on.length === 0) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5 px-4 pb-2">
      {on.map((property) => (
        <View key={property.key} className="h-8 flex-row items-center rounded-full border border-border pl-3">
          <Text className="text-sm text-muted-foreground">{property.label}: </Text>
          <Text className="max-w-40 text-sm" numberOfLines={1}>
            {summary(property, props.filters[property.key] ?? [])}
          </Text>
          <Pressable
            role="button"
            aria-label={`Remove ${property.label} filter`}
            hitSlop={6}
            className="h-full justify-center pr-2.5 pl-1.5"
            onPress={() => props.onChange({ ...props.filters, [property.key]: [] })}
          >
            <Icon as={IconX} className="size-3.5 text-muted-foreground" />
          </Pressable>
        </View>
      ))}
      <Button variant="ghost" size="sm" className="h-8 rounded-full" onPress={() => props.onChange({})}>
        <Text className="text-sm text-muted-foreground">Clear</Text>
      </Button>
    </ScrollView>
  )
}

function FilterRows(props: {
  readonly properties: ReadonlyArray<FilterProperty>
  readonly filters: Filters
  readonly onOpen: (key: string) => void
}) {
  return props.properties.map((property) => (
    <Pressable
      key={property.key}
      role="button"
      className="min-h-11 flex-row items-center gap-3 px-5 active:bg-accent"
      onPress={() => props.onOpen(property.key)}
    >
      <Text className="flex-1">{property.label}</Text>
      <Text
        className={cn(
          "max-w-44 text-sm",
          (props.filters[property.key] ?? []).length > 0 ? "text-foreground" : "text-muted-foreground",
        )}
        numberOfLines={1}
      >
        {summary(property, props.filters[property.key] ?? [])}
      </Text>
      <Icon as={ChevronRightIcon} className="size-4.5 text-muted-foreground" />
    </Pressable>
  ))
}

function FilterOptions(props: {
  readonly property: FilterProperty
  readonly selected: ReadonlyArray<string>
  readonly onChange: (values: ReadonlyArray<string>) => void
  readonly onBack: () => void
}) {
  const property = props.property
  const selected = props.selected
  return (
    <>
      <View className="flex-row items-center gap-1 px-2 pb-2">
        <Button variant="ghost" size="sm" aria-label="Back to filters" onPress={props.onBack}>
          <Icon as={ChevronLeftIcon} className="size-5" />
          <Text>Filter</Text>
        </Button>
        <Text role="heading" aria-level={2} className="text-base font-semibold">
          {property.label}
        </Text>
      </View>
      <OptionList
        options={property.single ? [{ value: "", label: property.any }, ...property.options] : property.options}
        selected={property.single ? [selected.at(0) ?? ""] : selected}
        multiple={property.single !== true}
        onSelect={(value) => {
          if (property.single) {
            props.onChange(value ? [value] : [])
            return props.onBack()
          }
          props.onChange(selected.includes(value) ? selected.filter((each) => each !== value) : [...selected, value])
        }}
      />
    </>
  )
}

export { FilterChips, FilterOptions, FilterRows, isFiltered, type FilterProperty, type Filters }
