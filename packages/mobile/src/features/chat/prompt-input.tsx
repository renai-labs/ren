import ArrowUpIcon from "react-native-heroicons/mini/ArrowUpIcon"
import PlusIcon from "react-native-heroicons/mini/PlusIcon"
import StopIcon from "react-native-heroicons/mini/StopIcon"
import { cn } from "cn"
import { useState } from "react"
import { View } from "react-native"
import { TextField } from "#components/input"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { type Attachments, UploadChips } from "#features/chat/attachments"
import { MenuSheet } from "#components/menu-sheet"

function AddAttachment(props: { readonly attachments: Attachments }) {
  const [adding, setAdding] = useState(false)
  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        className="rounded-full"
        hitSlop={4}
        aria-label="Add attachment"
        onPress={() => setAdding(true)}
      >
        <Icon as={PlusIcon} className="size-5" />
      </Button>
      <MenuSheet
        open={adding}
        title="Add attachment"
        items={props.attachments.items}
        onClose={() => setAdding(false)}
      />
    </>
  )
}

function SendButton(props: {
  readonly blank: boolean
  readonly running: boolean
  readonly uploading: boolean
  readonly onSend: () => void
  readonly onStop: () => void
}) {
  const stopping = props.running && props.blank
  return (
    <Button
      variant={props.blank && !stopping ? "secondary" : "default"}
      size="icon"
      className="rounded-full"
      hitSlop={4}
      aria-label={stopping ? "Stop" : "Send"}
      aria-disabled={(props.blank && !stopping) || props.uploading}
      accessibilityHint={props.uploading ? "Wait for the files to upload" : undefined}
      disabled={props.uploading && !stopping}
      onPress={() => {
        if (stopping) props.onStop()
        else if (!props.blank) props.onSend()
      }}
    >
      <Icon as={stopping ? StopIcon : ArrowUpIcon} className="size-5" />
    </Button>
  )
}

function PromptInput(props: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSend: () => void
  readonly onStop: () => void
  readonly running: boolean
  readonly attachments?: Attachments
  readonly placeholder?: string
}) {
  return (
    <View className="mx-3 rounded-4xl border border-transparent bg-card shadow-soft dark:border-border dark:shadow-none">
      {props.attachments ? <UploadChips attachments={props.attachments} /> : null}
      <View className={cn("min-h-14 flex-row items-end gap-2 py-2 pr-2", props.attachments ? "pl-2" : "pl-5")}>
        {props.attachments ? <AddAttachment attachments={props.attachments} /> : null}
        <TextField
          className="max-h-40 min-h-10 flex-1 py-2 text-base"
          value={props.value}
          onChangeText={props.onChange}
          placeholder={props.placeholder ?? "Ask anything"}
          aria-label="Message"
          multiline
        />
        <SendButton
          blank={props.value.trim() === ""}
          running={props.running}
          uploading={(props.attachments?.uploads.length ?? 0) > 0}
          onSend={props.onSend}
          onStop={props.onStop}
        />
      </View>
    </View>
  )
}

export { PromptInput }
