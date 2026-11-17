import ArrowUpIcon from "react-native-heroicons/mini/ArrowUpIcon"
import PlusIcon from "react-native-heroicons/mini/PlusIcon"
import StopIcon from "react-native-heroicons/mini/StopIcon"
import { cn } from "cn"
import { type ComponentProps, type ComponentRef, type ReactNode, type RefObject, useRef, useState } from "react"
import { type TextInput, View } from "react-native"
import { TextField } from "#components/input"
import { Morph } from "#components/appear"
import { Button } from "#components/button"
import { Icon } from "#components/icon"
import { type Attachments, UploadChips } from "#features/chat/attachments"
import { MenuSheet } from "#components/menu-sheet"
import { ModelPicker } from "#features/chat/model-picker"

function AddAttachment(props: { readonly attachments: Attachments; readonly onOpenChange: (open: boolean) => void }) {
  const [sheet, setSheet] = useState(false)
  const adding = sheet
  const setAdding = (next: boolean) => {
    setSheet(next)
    props.onOpenChange(next)
  }
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
  readonly attachments: Attachments | undefined
  readonly onSend: () => void
  readonly onStop: () => void
}) {
  const stopping = props.running && props.blank
  const uploading = (props.attachments?.uploads.length ?? 0) > 0
  return (
    <Button
      variant={props.blank && !stopping ? "secondary" : "default"}
      size="icon"
      className="rounded-full"
      hitSlop={4}
      aria-label={stopping ? "Stop" : "Send"}
      aria-disabled={(props.blank && !stopping) || uploading}
      accessibilityHint={uploading ? "Wait for the files to upload" : undefined}
      disabled={uploading && !stopping}
      onPress={() => {
        if (stopping) props.onStop()
        else if (!props.blank) props.onSend()
      }}
    >
      <Icon as={stopping ? StopIcon : ArrowUpIcon} className="size-5" />
    </Button>
  )
}

type ModelProps = Omit<ComponentProps<typeof ModelPicker>, "onOpenChange">

function Toolbar(props: {
  readonly add: ReactNode
  readonly send: ReactNode
  readonly model: ModelProps | undefined
  readonly field: RefObject<ComponentRef<typeof TextInput> | null>
  readonly onHold: (holding: boolean) => void
}) {
  return (
    <View className="flex-row items-center gap-1 px-2 pb-2">
      {props.add}
      <View className="flex-1 flex-row items-center">
        {props.model ? (
          <ModelPicker
            {...props.model}
            onOpenChange={(open) => {
              props.onHold(open)
              if (!open) props.field.current?.focus()
            }}
          />
        ) : null}
      </View>
      {props.send}
    </View>
  )
}

function PromptInput(props: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly onSend: () => void
  readonly onStop: () => void
  readonly running: boolean
  readonly attachments?: Attachments
  readonly model?: ModelProps
  readonly placeholder?: string
}) {
  const field = useRef<ComponentRef<typeof TextInput>>(null)
  const [focused, setFocused] = useState(false)
  const [holding, setHolding] = useState(false)
  const expandable = Boolean(props.attachments ?? props.model)
  const expanded = expandable && (focused || holding)
  const add = props.attachments ? <AddAttachment attachments={props.attachments} onOpenChange={setHolding} /> : null
  const send = (
    <SendButton
      blank={props.value.trim() === ""}
      running={props.running}
      attachments={props.attachments}
      onSend={props.onSend}
      onStop={props.onStop}
    />
  )
  return (
    <Morph
      className={cn(
        "mx-3 border border-black/10 bg-card shadow-soft dark:border-white/15 dark:shadow-none",
        expanded ? "rounded-3xl" : "rounded-4xl",
      )}
    >
      <UploadChips attachments={props.attachments} />
      <View className={cn("min-h-14 flex-row items-end gap-2 py-2 pr-2", expandable ? "pl-2" : "pl-3")}>
        {expanded ? null : add}
        <TextField
          ref={field}
          className="max-h-40 min-h-10 flex-1 p-2 text-base"
          value={props.value}
          onChangeText={props.onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={props.placeholder ?? "Ask anything"}
          aria-label="Message"
          multiline
        />
        {expanded ? null : send}
      </View>
      {expanded ? <Toolbar add={add} send={send} model={props.model} field={field} onHold={setHolding} /> : null}
    </Morph>
  )
}

export { PromptInput }
