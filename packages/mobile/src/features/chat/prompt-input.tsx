import ArrowUpIcon from "react-native-heroicons/mini/ArrowUpIcon"
import CodeBracketIcon from "react-native-heroicons/mini/CodeBracketIcon"
import PlusIcon from "react-native-heroicons/mini/PlusIcon"
import PuzzlePieceIcon from "react-native-heroicons/mini/PuzzlePieceIcon"
import StopIcon from "react-native-heroicons/mini/StopIcon"
import type { Composer } from "@ren/chat"
import { cn } from "cn"
import { type ComponentProps, type ComponentRef, type ReactNode, type RefObject, useRef, useState } from "react"
import { ActivityIndicator, Pressable, ScrollView, type TextInput, View } from "react-native"
import { TextField } from "#components/input"
import { Appear, Morph } from "#components/appear"
import { AppIcon } from "#components/app-icon"
import { GitHubIcon } from "#components/brand-mark"
import { Button } from "#components/button"
import { FileIcon } from "#components/file-icon"
import { Icon } from "#components/icon"
import { Text } from "#components/text"
import { AppsPanel } from "#features/chat/apps-panel"
import { type Attachments, UploadChips } from "#features/chat/attachments"
import { MenuSheet } from "#components/menu-sheet"
import type { Suggestion, Suggestions } from "#features/chat/mentions"
import { ModelPicker } from "#features/chat/model-picker"
import { RepositoriesPanel } from "#features/chat/repositories-panel"

type SpaceActions = { readonly id: string; readonly onMentionApp: (app: Composer.MentionedApp) => void }

const groups = ["Apps", "Repositories", "Files"] as const

function SuggestionIcon(props: { readonly item: Suggestion }) {
  if (props.item.kind === "app")
    return <AppIcon name={props.item.label} icon={props.item.icon} className="size-6 rounded-md" />
  if (props.item.kind === "file") return <FileIcon name={props.item.label} />
  return <Icon as={CodeBracketIcon} className="size-5 text-muted-foreground" />
}

function SuggestionList(props: { readonly suggest: Suggestions | undefined }) {
  const suggest = props.suggest
  if (!suggest?.open) return null
  return (
    <Appear className="mx-3 mb-2 max-h-64 overflow-hidden rounded-2xl border border-black/10 bg-card shadow-soft dark:border-white/15 dark:shadow-none">
      <ScrollView keyboardShouldPersistTaps="always" keyboardDismissMode="none" role="menu" aria-label="Mentions">
        {groups.map((group) => {
          const items = suggest.items.filter((item) => item.group === group)
          return items.length === 0 ? null : (
            <View key={group}>
              <Text className="px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">{group}</Text>
              {items.map((item) => (
                <Pressable
                  key={item.value}
                  role="menuitem"
                  className="min-h-11 flex-row items-center gap-3 px-4 active:bg-accent"
                  onPress={() => suggest.onChoose(item.value)}
                >
                  <SuggestionIcon item={item} />
                  <Text className="shrink font-medium" numberOfLines={1}>
                    {item.label}
                  </Text>
                  {item.description ? (
                    <Text className="min-w-0 flex-1 text-sm text-muted-foreground" numberOfLines={1}>
                      {item.description}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )
        })}
        {suggest.searching ? (
          <ActivityIndicator colorClassName="accent-muted-foreground" size="small" className="py-3" />
        ) : null}
      </ScrollView>
    </Appear>
  )
}

function AddMenu(props: {
  readonly attachments: Attachments
  readonly space: SpaceActions | undefined
  readonly field: RefObject<ComponentRef<typeof TextInput> | null>
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const mentioned = useRef(false)
  const space = props.space
  const open = (next: boolean) => {
    props.onOpenChange(next)
    if (!next && mentioned.current) props.field.current?.focus()
    mentioned.current = false
  }
  const apps = (id: string, onMentionApp: SpaceActions["onMentionApp"]) => (
    <AppsPanel
      spaceId={id}
      onMention={(app) => {
        mentioned.current = true
        onMentionApp(app)
      }}
    />
  )
  return (
    <>
      <Button
        variant="secondary"
        size="icon"
        className="rounded-full"
        hitSlop={4}
        aria-label="Add to this chat"
        onPress={() => open(true)}
      >
        <Icon as={PlusIcon} className="size-5" />
      </Button>
      <MenuSheet
        open={props.open}
        title="Add to this chat"
        items={[
          ...props.attachments.items.map((item) => ({ ...item, group: "Upload attachment" })),
          ...(space
            ? [
                { label: "Apps", icon: PuzzlePieceIcon, panel: apps(space.id, space.onMentionApp) },
                { label: "Repositories", icon: GitHubIcon, panel: <RepositoriesPanel spaceId={space.id} /> },
              ]
            : []),
        ]}
        onClose={() => open(false)}
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
  readonly suggest?: Suggestions
  readonly space?: { readonly id: string; readonly onMentionApp: (app: Composer.MentionedApp) => void }
}) {
  const field = useRef<ComponentRef<typeof TextInput>>(null)
  const [focused, setFocused] = useState(false)
  const [holding, setHolding] = useState(false)
  const [adding, setAdding] = useState(false)
  const expandable = Boolean(props.attachments ?? props.model)
  const add = props.attachments ? (
    <AddMenu
      attachments={props.attachments}
      space={props.space}
      field={field}
      open={adding}
      onOpenChange={(next) => {
        setAdding(next)
        setHolding(next)
      }}
    />
  ) : null
  const expanded = expandable && (focused || holding)
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
    <>
      <SuggestionList suggest={props.suggest} />
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
            onBlur={() => {
              setFocused(false)
              props.suggest?.onClose()
            }}
            onSelectionChange={(event) => props.suggest?.onCursor(event.nativeEvent.selection.end)}
            selection={props.suggest?.selection}
            placeholder={props.placeholder ?? "Ask anything"}
            aria-label="Message"
            multiline
          />
          {expanded ? null : send}
        </View>
        {expanded ? <Toolbar add={add} send={send} model={props.model} field={field} onHold={setHolding} /> : null}
      </Morph>
    </>
  )
}

export { PromptInput }
