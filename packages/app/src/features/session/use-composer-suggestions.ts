import { useState } from "react"
import { ClientCommand, Composer, Mentions } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { AsyncResult } from "effect/reactivity"
import { fromApp, fromRegistry, hasManaged, isSpaceApp, mentionColor, type Status } from "../../lib/apps.js"
import { pageSize, pickerPageSize } from "../../lib/pagination.js"
import { useSpaces } from "../../lib/use-spaces.js"
import type { MentionMark } from "@ren/ui/mention-overlay"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Repositories } from "../../lib/repositories.js"
import { RouterContext } from "../../lib/router-context.js"
import { useSpaceApps } from "./use-space-apps.js"
import { useDebouncedValue } from "../../lib/use-debounced-value.js"

const groupSize = 5
const fileSearchDelay = 250
const unrooted = Session.ID.create()
type Items = ReadonlyArray<Mentions.Item>
const filePill = /(?<=^|\s)@ {2}([^\s@]*[./][^\s@]*)/g

interface SuggestionItem {
  readonly value: string
  readonly kind: "command" | Mentions.Kind
  readonly label: string
  readonly group?: "Apps" | "Repositories" | "Files" | undefined
  readonly description?: string | undefined
  readonly icon?: string | null | undefined
  readonly status?: Status | undefined
}

export interface Suggest {
  readonly open: boolean
  readonly label: string
  readonly searching: boolean
  readonly items: ReadonlyArray<SuggestionItem>
  readonly active: string | undefined
  readonly onCursor: (text: string, cursor: number) => void
  readonly onKey: (press: Composer.SuggestionPress) => boolean
  readonly onChoose: (
    value: string,
    text: string,
    cursor: number,
  ) => { text: string; cursor: number; focus?: boolean; mention?: Composer.MentionedApp | undefined } | undefined
  readonly onClose: () => void
  readonly marks: (text: string) => ReadonlyArray<MentionMark>
  readonly mentioned: (text: string) => ReadonlyArray<Composer.MentionedApp>
  readonly unmention: (
    text: string,
    press: { key: string; selectionStart: number; selectionEnd: number },
  ) => { text: string; cursor: number } | undefined
}

const listed = <A>(result: AsyncResult.AsyncResult<ReadonlyArray<A>, unknown>) =>
  AsyncResult.isSuccess(result) ? result.value : []

export function useComposerSuggestions(input: {
  root: Session.ID
  spaceId: string | undefined
  mentions: ReadonlyArray<Composer.MentionedApp>
  commands: boolean
  client: Readonly<Record<ClientCommand.ID, boolean>>
  onClient: (id: ClientCommand.ID, text: string) => void
}) {
  const offered = Composer.offeredCommands(listed(ChatReact.useCommands(input.root)))
  const brain = input.commands ? offered : []
  const client = ClientCommand.offered(input.client).filter(
    (item) => !brain.some((command) => command.name === item.trigger),
  )
  const core = useSuggestions({
    root: input.root,
    spaceId: input.spaceId,
    mentions: input.mentions,
    commands: (query) => ClientCommand.suggestions(client, brain, query),
    onClient: input.onClient,
  })
  return {
    ...core,
    slash: (text: string) => Composer.slash(text, brain),
    client: (text: string) => ClientCommand.parse(client, text),
  }
}

export const useMentionSuggestions = (spaceId: string | undefined, mentions: ReadonlyArray<Composer.MentionedApp>) =>
  useSuggestions({ root: undefined, spaceId, mentions, commands: () => [], onClient: () => undefined })

function useRepositoryMentions(spaceId: string | undefined): ReadonlyArray<Mentions.Item> {
  const { api } = RouterContext.useRouterContext()
  const settings = useQuery({
    ...api["space-settings"].get.queryOptions({ idOrSlug: spaceId ?? "" }),
    enabled: spaceId !== undefined,
  })
  return (settings.data?.settings.references ?? []).map((reference) => ({
    kind: "repository",
    id: reference.alias,
    label: Repositories.nameOf(reference.repository),
    handle: reference.alias,
    description: reference.description || reference.repository,
  }))
}

function useAppMentions(query: string | undefined, mentions: ReadonlyArray<Composer.MentionedApp>) {
  const { api } = RouterContext.useRouterContext()
  const spaces = useSpaces().spaces
  const own = useQuery(api.app.list.queryOptions({ page: 1, pageSize: pickerPageSize }))
  const found = useQuery({
    ...api["app-registry"].list.queryOptions({ page: 1, pageSize, ...(query && { query }) }),
    enabled: query !== undefined,
    placeholderData: keepPreviousData,
  })
  const managed = new Set([
    ...(own.data?.items ?? [])
      .map(fromApp)
      .filter(hasManaged)
      .map((app) => app.id),
    ...(found.data?.items ?? []).filter((app) => app.managed).map((app) => app.id),
  ])
  const byId = new Map<string, Composer.MentionedApp>(
    [
      ...(own.data?.items ?? []).map(fromApp).filter((app) => !isSpaceApp(app, spaces)),
      ...mentions,
      ...(query === undefined ? [] : (found.data?.items ?? []).map(fromRegistry)),
    ].map((app) => [app.id, app]),
  )
  return {
    byId,
    items: [...byId.values()].map(Mentions.fromApp),
    searching: query !== undefined && found.isFetching,
    managed: (appId: string) => managed.has(appId),
    mentionOf: (appId: string): Composer.MentionedApp | undefined => {
      const app = byId.get(appId)
      return (
        app && {
          id: app.id,
          slug: app.slug,
          name: app.name,
          description: app.description,
          icon: app.icon,
          brandColor: app.brandColor,
        }
      )
    },
  }
}

const filePills = (text: string) =>
  Array.from(text.matchAll(filePill), (match) => Mentions.fromFile({ path: match[1] ?? "", type: "file" }))

const groupMentions = (query: string, lists: readonly [apps: Items, repositories: Items, files: Items]) => {
  const named = (items: Items) =>
    items
      .filter((item) => [item.label, item.handle].some((value) => value.toLowerCase().includes(query)))
      .slice(0, groupSize)
  return [
    ...named(lists[0]).map((item) => ({ item, group: "Apps" as const })),
    ...named(lists[1]).map((item) => ({ item, group: "Repositories" as const })),
    ...lists[2].slice(0, groupSize).map((item) => ({ item, group: "Files" as const })),
  ]
}

const suggestionLabel = (trigger: Composer.Trigger | undefined) =>
  trigger?.kind === "command" ? "Commands" : "Mentions"

const mentionItem = (
  entry: ReturnType<typeof groupMentions>[number],
  icon: string | null | undefined,
  status: Status | undefined,
): SuggestionItem => ({
  value: Mentions.key(entry.item),
  kind: entry.item.kind,
  group: entry.group,
  label: entry.item.label,
  description: entry.item.description,
  icon,
  status,
})

function useFileMentions(root: Session.ID | undefined, query: string | undefined) {
  const text = useDebouncedValue(query ?? "", fileSearchDelay)
  const result = ChatReact.useFiles({ root: root ?? unrooted, query: root ? text : "", type: "file" })
  const [kept, setKept] = useState<ReadonlyArray<Mentions.Item>>([])
  if (AsyncResult.isSuccess(result)) {
    const next = result.value.map(Mentions.fromFile)
    if (next.length !== kept.length || next.some((item, index) => item.id !== kept[index]?.id)) setKept(next)
  }
  const active = root !== undefined && query !== undefined && query !== ""
  return {
    items: active ? kept : [],
    searching: active && (text !== query || AsyncResult.isWaiting(result)),
  }
}

function useSuggestions(input: {
  root: Session.ID | undefined
  spaceId: string | undefined
  mentions: ReadonlyArray<Composer.MentionedApp>
  commands: (query: string) => ReadonlyArray<ClientCommand.Suggestion>
  onClient: (id: ClientCommand.ID, text: string) => void
}) {
  const [trigger, setTrigger] = useState<Composer.Trigger>()
  const [active, setActive] = useState<string>()
  const query = trigger?.kind === "mention" ? trigger.query.toLowerCase() : undefined
  const apps = useAppMentions(query, input.mentions)
  const space = useSpaceApps(input.spaceId)
  const appById = apps.byId
  const repositories = useRepositoryMentions(input.spaceId)
  const found = useFileMentions(input.root, query)
  const connectors = [...apps.items, ...repositories]
  const runnable = trigger?.kind === "command" ? input.commands(trigger.query) : []
  const searching = apps.searching || found.searching
  const grouped = query === undefined ? [] : groupMentions(query, [apps.items, repositories, found.items])
  const mentionable = grouped.map((entry) => entry.item)
  const items: ReadonlyArray<SuggestionItem> =
    trigger?.kind === "command"
      ? runnable.map((item) => ({
          value: item.value,
          kind: "command",
          label: `/${item.trigger}`,
          description: item.description,
        }))
      : grouped.map((entry) =>
          mentionItem(
            entry,
            appById.get(entry.item.id)?.icon,
            entry.item.kind === "app" && input.spaceId
              ? space.status(entry.item.id, { managed: apps.managed(entry.item.id) })
              : undefined,
          ),
        )
  const ids = items.map((item) => item.value)
  const current = Composer.activeSuggestion(ids, active)
  const tokens = (text: string) => Mentions.tokens(text, [...connectors, ...filePills(text)])
  const close = () => {
    setTrigger(undefined)
    setActive(undefined)
  }
  const suggest: Suggest = {
    open: trigger !== undefined && (items.length > 0 || searching),
    label: suggestionLabel(trigger),
    searching,
    items,
    active: current,
    onCursor: (text, cursor) => {
      setTrigger(Composer.trigger(text, cursor))
      setActive(undefined)
    },
    onKey: (press) => {
      if (trigger === undefined || ids.length === 0) return false
      const key = Composer.suggestionKey(press, ids, current)
      if (key?.type === "close") close()
      if (key?.type === "move") setActive(key.active)
      return key !== undefined && key.type !== "select"
    },
    onChoose: (value, text, cursor) => {
      close()
      if (trigger?.kind === "command") {
        const command = runnable.find((item) => item.value === value)
        if (command?.client) {
          input.onClient(command.client, "")
          return { text: "", cursor: 0, focus: !ClientCommand.leavesComposer(command.client) }
        }
        const next = `/${command?.trigger ?? value} `
        return { text: next, cursor: next.length }
      }
      const item = mentionable.find((entry) => Mentions.key(entry) === value)
      if (!item || trigger?.kind !== "mention") return
      return {
        ...Mentions.insert(text, item, trigger.start, cursor),
        mention: item.kind === "app" ? apps.mentionOf(item.id) : undefined,
      }
    },
    onClose: close,
    marks: (text) =>
      tokens(text).map((token) => {
        const app = appById.get(token.item.id)
        return {
          start: token.start,
          end: token.end,
          label: token.item.label,
          icon: app?.icon ?? null,
          color: mentionColor(app),
        }
      }),
    mentioned: (text) => [
      ...new Map(
        tokens(text).flatMap((token) => {
          const app = token.item.kind === "app" ? apps.mentionOf(token.item.id) : undefined
          return app ? [[app.id, app] as const] : []
        }),
      ).values(),
    ],
    unmention: (text, press) => Mentions.remove(text, tokens(text), press),
  }
  return {
    suggest,
    resolve: (text: string) => Mentions.resolve(text, tokens(text)),
  }
}
