import { ClientCommand, Composer, Mentions } from "@ren/chat"
import { AppMention } from "@ren/ui/app-mention"
import { PromptInput } from "@ren/ui/prompt-input"
import { IconFile, IconGhost, IconSparkles, IconTerminal2 } from "@tabler/icons-react"
import { useState } from "react"
import type { KeyboardEvent, ReactNode, RefObject } from "react"
import type { ComposerKeys } from "./composer-keys.js"
import type { SessionApps } from "./session-apps.js"

const trailingSpace = /\s$/

export interface Catalog {
  readonly byId: ReadonlyMap<string, SessionApps.App>
  readonly apps: ReadonlyArray<Mentions.Item>
  readonly agents: ReadonlyArray<Mentions.Item>
  readonly skills: ReadonlyArray<Mentions.Item>
  readonly files: ReadonlyArray<Mentions.Item>
}

interface Suggesting {
  readonly trigger: Composer.Trigger
  readonly active?: string
}

const mentionIcons: Readonly<Record<Exclude<Mentions.Kind, "app">, ReactNode>> = {
  agent: <IconGhost />,
  skill: <IconSparkles />,
  file: <IconFile />,
}

const mentionGroups: Readonly<Record<Mentions.Kind, string>> = {
  agent: "Agents",
  skill: "Skills",
  file: "Files",
  app: "Apps",
}

const iconOf = (item: Mentions.Item, apps: ReadonlyMap<string, SessionApps.App>) =>
  item.kind === "app" ? (
    <AppMention.Logo name={item.label} icon={apps.get(item.id)?.icon ?? null} className="size-4" />
  ) : (
    mentionIcons[item.kind]
  )

const commandSuggestions = (commands: ReadonlyArray<ClientCommand.Suggestion>): ReadonlyArray<PromptInput.Suggestion> =>
  commands.map((item) => ({
    value: item.value,
    group: "Commands",
    label: `/${item.trigger}`,
    description: item.description,
    icon: <IconTerminal2 />,
  }))

const mentionSuggestions = (
  items: ReadonlyArray<Mentions.Item>,
  apps: ReadonlyMap<string, SessionApps.App>,
): ReadonlyArray<PromptInput.Suggestion> =>
  items.map((item) => ({
    value: Mentions.key(item),
    group: mentionGroups[item.kind],
    label: item.label,
    description: item.description,
    icon: iconOf(item, apps),
  }))

export const pressOf = (event: KeyboardEvent<HTMLTextAreaElement>): ComposerKeys.Press => ({
  key: event.key,
  metaKey: event.metaKey,
  ctrlKey: event.ctrlKey,
  shiftKey: event.shiftKey,
  altKey: event.altKey,
  repeat: event.repeat,
  isComposing: event.nativeEvent.isComposing,
})

export function useSuggesting() {
  const [suggesting, setSuggesting] = useState<Suggesting>()
  const trigger = suggesting?.trigger
  return { suggesting, setSuggesting, mention: trigger?.kind === "mention" ? trigger.query : undefined }
}

export function useSuggestions(input: {
  state: ReturnType<typeof useSuggesting>
  catalog: Catalog
  offered: Parameters<typeof ClientCommand.suggestions>[1]
  client: ReadonlyArray<ClientCommand.Command>
  text: string
  readOnly: boolean
  field: RefObject<HTMLTextAreaElement | null>
  onText: (text: string, cursor: number) => void
  onClient: (id: ClientCommand.ID) => void
  side?: "top" | "bottom"
}) {
  const state = input.state
  const trigger = state.suggesting?.trigger
  const [picked, setPicked] = useState<ReadonlyArray<Mentions.Item>>([])
  const runnable = ClientCommand.suggestions(
    input.client,
    input.offered,
    trigger?.kind === "command" ? trigger.query : "",
  )
  const mentionable = state.mention === undefined ? [] : Mentions.suggest({ ...input.catalog, query: state.mention })
  const suggestions =
    trigger?.kind === "command" ? commandSuggestions(runnable) : mentionSuggestions(mentionable, input.catalog.byId)
  const ids = suggestions.map((item) => item.value)
  const active = Composer.activeSuggestion(ids, state.suggesting?.active)
  const known = [...input.catalog.agents, ...input.catalog.skills, ...input.catalog.apps, ...picked]
  const tokens = Mentions.tokens(input.text, known)
  const caret = (position: number, text: string) =>
    requestAnimationFrame(() => {
      const node = input.field.current
      if (!node || node.value !== text) return
      node.focus()
      node.setSelectionRange(position, position)
    })
  const write = (text: string, cursor: number) => {
    input.onText(text, cursor)
    caret(cursor, text)
  }
  const choose = (value: string) => {
    state.setSuggesting(undefined)
    if (trigger?.kind === "command") {
      const found = runnable.find((item) => item.value === value)
      if (found?.client) {
        input.onText("", 0)
        input.onClient(found.client)
        return
      }
      const text = `/${found?.trigger ?? value} `
      write(text, text.length)
      return
    }
    const item = mentionable.find((entry) => Mentions.key(entry) === value)
    if (!item || !trigger) return
    const inserted = Mentions.insert(
      input.text,
      item,
      trigger.start,
      input.field.current?.selectionStart ?? input.text.length,
    )
    if (item.kind === "file") setPicked((current) => [...current, item])
    write(inserted.text, inserted.cursor)
  }
  return {
    trigger,
    runnable,
    tokens,
    resolve: (text: string) => Mentions.resolve(text, Mentions.tokens(text, known)),
    close: () => state.setSuggesting(undefined),
    track: (text: string, cursor: number) => {
      const next = Composer.trigger(text, cursor)
      state.setSuggesting(next && { trigger: next })
    },
    openCommands: () => {
      state.setSuggesting({ trigger: { kind: "command", query: "" } })
      write("/", 1)
    },
    runCommand: (found: ClientCommand.Suggestion) => {
      if (found.client) return input.onClient(found.client)
      const text = `/${found.trigger} ${input.text.trim()}`
      write(text, text.length)
    },
    mention: () => {
      const cursor = input.field.current?.selectionStart ?? input.text.length
      const before = input.text.slice(0, cursor)
      const inserted = Composer.insert(input.text, before === "" || trailingSpace.test(before) ? "@" : " @", cursor)
      write(inserted.text, inserted.cursor)
      const next = Composer.trigger(inserted.text, inserted.cursor)
      state.setSuggesting(next && { trigger: next })
    },
    keyDown: (pressed: ComposerKeys.Press, node: HTMLTextAreaElement) => {
      const key = ids.length > 0 ? Composer.suggestionKey(pressed, ids, active) : undefined
      if (key?.type === "close") state.setSuggesting(undefined)
      if (key?.type === "move") state.setSuggesting((current) => current && { ...current, active: key.active })
      if (key?.type === "select") choose(key.id)
      if (key) return true
      const removed = input.readOnly
        ? undefined
        : Mentions.remove(input.text, tokens, {
            key: pressed.key,
            selectionStart: node.selectionStart,
            selectionEnd: node.selectionEnd,
          })
      if (!removed) return false
      write(removed.text, removed.cursor)
      const next = Composer.trigger(removed.text, removed.cursor)
      state.setSuggesting(next && { trigger: next })
      return true
    },
    panel:
      suggestions.length > 0 ? (
        <PromptInput.Suggestions
          side={input.side ?? "top"}
          label={trigger?.kind === "command" ? "Commands" : "Mentions"}
          items={suggestions}
          active={active}
          onActiveChange={(value) => state.setSuggesting((current) => current && { ...current, active: value })}
          onSelect={choose}
        />
      ) : undefined,
    textarea: {
      mentions: tokens.map((token) => ({
        start: token.start,
        end: token.end,
        label: token.item.label,
        icon: iconOf(token.item, input.catalog.byId),
      })),
      suggesting: suggestions.length > 0,
      activeSuggestion: active,
    },
  }
}
