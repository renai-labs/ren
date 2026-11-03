import IconArrowUp from "@tabler/icons-react-native/IconArrowUp"
import IconPlayerStopFilled from "@tabler/icons-react-native/IconPlayerStopFilled"
import { TextInput, View } from "react-native"
import { Button } from "#components/button"
import { Icon } from "#components/icon"

function Composer(props: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSend: () => void
  readonly onStop: () => void
  readonly running: boolean
}) {
  const stopping = props.running && props.value.trim() === ""
  return (
    <View className="bg-background px-3 pt-2 pb-safe-offset-2">
      <View className="flex-row items-end gap-2 rounded-3xl border border-border bg-card py-1.5 pr-1.5 pl-4">
        <TextInput
          className="max-h-40 min-h-9 flex-1 py-2 text-base text-foreground placeholder:text-muted-foreground"
          value={props.value}
          onChangeText={props.onChange}
          placeholder="Ask anything"
          aria-label="Message"
          multiline
        />
        <Button
          size="icon"
          className="size-9 rounded-full"
          aria-label={stopping ? "Stop" : "Send"}
          disabled={!stopping && props.value.trim() === ""}
          onPress={stopping ? props.onStop : props.onSend}
        >
          <Icon as={stopping ? IconPlayerStopFilled : IconArrowUp} className="size-4.5" />
        </Button>
      </View>
    </View>
  )
}

export { Composer }
