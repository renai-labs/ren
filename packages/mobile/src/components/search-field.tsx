import IconX from "@tabler/icons-react-native/IconX"
import { Pressable, View } from "react-native"
import MagnifyingGlassIcon from "react-native-heroicons/mini/MagnifyingGlassIcon"
import { Icon } from "#components/icon"
import { TextField } from "#components/input"

function SearchField(props: {
  readonly value: string
  readonly label: string
  readonly autoFocus?: boolean
  readonly onChange: (value: string) => void
}) {
  return (
    <View className="h-10 flex-row items-center gap-2 rounded-xl bg-muted px-3 dark:bg-secondary">
      <Icon as={MagnifyingGlassIcon} className="size-4.5 text-muted-foreground" />
      <TextField
        className="flex-1 text-base"
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.label}
        aria-label={props.label}
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- the field opens because the person asked to search
        autoFocus={props.autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {props.value ? (
        <Pressable role="button" aria-label="Clear search" onPress={() => props.onChange("")}>
          <Icon as={IconX} className="size-4.5 text-muted-foreground" />
        </Pressable>
      ) : null}
    </View>
  )
}

export { SearchField }
