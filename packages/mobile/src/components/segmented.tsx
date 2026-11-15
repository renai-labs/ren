import { cn } from "cn"
import { Pressable, View } from "react-native"
import { Text } from "#components/text"

function Segmented<V extends string>(props: {
  readonly label: string
  readonly options: ReadonlyArray<{ readonly value: V; readonly label: string }>
  readonly value: V
  readonly onChange: (value: V) => void
}) {
  return (
    <View role="radiogroup" aria-label={props.label} className="flex-row rounded-lg bg-muted p-0.5">
      {props.options.map((option) => (
        <Pressable
          key={option.value}
          role="radio"
          aria-checked={option.value === props.value}
          className={cn(
            "min-h-9 flex-1 items-center justify-center rounded-md px-3",
            option.value === props.value ? "bg-card shadow-soft" : "active:opacity-70",
          )}
          onPress={() => props.onChange(option.value)}
        >
          <Text
            className={cn(
              "text-sm",
              option.value === props.value ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  )
}

export { Segmented }
