import { useState } from "react"
import { ClientCommand, Composer, Mentions } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import { AsyncResult } from "effect/reactivity"
import { fromApp, fromRegistry, isSpaceApp, mentionColor, type CatalogApp } from "../../lib/apps.js"
import { pageSize, pickerPageSize } from "../../lib/pagination.js"
import { useSpaces } from "../../lib/use-spaces.js"
import type { MentionMark } from "@ren/ui/mention-overlay"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Repositories } from "../../lib/repositories.js"
import { RouterContext } from "../../lib/router-context.js"

interface SuggestionItem {
  readonly value: string
  readonly kind: "command" | Mentions.Kind
  readonly label: string
  readonly description?: string | undefined
  readonly icon?: string | null | undefined
}

export interface Suggest {
  readonly open: boolean
  readonly label: string
  readonly searching: boolean
  readonly items: ReadonlyArray<SuggestionItem>
  readonly active: string | undefined
  readonly onCursor: (text: string, cursor: number) => void
  readonly onKey: (press: Composer.SuggestionPress) => boolean
  readonly onChoose: (value: string, text: string, cursor: number) => { text: string; cursor: number } | undefined
  readonly onClose: () => void
  readonly marks: (text: string) => ReadonlyArray<MentionMark>
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
  commands: boolean
  client: Readonly<Record<ClientCommand.ID, boolean>>
  onClient: (id: ClientCommand.ID) => void
}) {
  const offered = Composer.offeredCommands(listed(ChatReact.useCommands(input.root)))
  const brain = input.commands ? offered : []
  const core = useSuggestions({
    spaceId: input.spaceId,
    commands: (query) => ClientCommand.suggestions(ClientCommand.offered(input.client), brain, query),
    onClient: input.onClient,
  })
  return { ...core, slash: (text: string) => Composer.slash(text, brain) }
}

export const useMentionSuggestions = (spaceId: string | undefined) =>
  useSuggestions({ spaceId, commands: () => [], onClient: () => undefined })

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

function useAppMentions(query: string | undefined) {
  const { api } = RouterContext.useRouterContext()
  const spaces = useSpaces().spaces
  const own = useQuery(api.app.list.queryOptions({ page: 1, pageSize: pickerPageSize }))
  const found = useQuery({
    ...api["app-registry"].list.queryOptions({ page: 1, pageSize, ...(query && { query }) }),
    enabled: query !== undefined,
    placeholderData: keepPreviousData,
  })
  const [chosen, setChosen] = useState<ReadonlyArray<CatalogApp>>([])
  const byId = new Map(
    [
      ...(own.data?.items ?? []).map(fromApp),
      ...chosen,
      ...(query === undefined ? [] : (found.data?.items ?? []).map(fromRegistry)),
    ].map((app) => [app.id, app]),
  )
  return {
    byId,
    items: [...byId.values()]
      .filter((app) => !isSpaceApp(app, spaces))
      .map((app): Mentions.Item => ({
        kind: "app",
        id: app.id,
        label: app.name,
        handle: app.slug,
        description: app.description,
      })),
    searching: query !== undefined && found.isFetching,
    choose: (appId: string) => {
      const app = byId.get(appId)
      if (app) setChosen((previous) => [...previous.filter((each) => each.id !== app.id), app])
    },
  }
}

const suggestionLabel = (trigger: Composer.Trigger | undefined, options: { repositories: boolean }) => {
  if (trigger?.kind === "command") return "Commands"
  return options.repositories ? "Apps and repositories" : "Apps"
}

function useSuggestions(input: {
  spaceId: string | undefined
  commands: (query: string) => ReadonlyArray<ClientCommand.Suggestion>
  onClient: (id: ClientCommand.ID) => void
}) {
  const [trigger, setTrigger] = useState<Composer.Trigger>()
  const [active, setActive] = useState<string>()
  const query = trigger?.kind === "mention" ? trigger.query.toLowerCase() : undefined
  const apps = useAppMentions(query)
  const appById = apps.byId
  const repositories = useRepositoryMentions(input.spaceId)
  const connectors = [...apps.items, ...repositories]
  const runnable = trigger?.kind === "command" ? input.commands(trigger.query) : []
  const mentionable =
    query === undefined
      ? []
      : connectors.filter((item) => [item.label, item.handle].some((value) => value.toLowerCase().includes(query)))
  const items: ReadonlyArray<SuggestionItem> =
    trigger?.kind === "command"
      ? runnable.map((item) => ({
          value: item.value,
          kind: "command",
          label: `/${item.trigger}`,
          description: item.description,
        }))
      : mentionable.map((item) => ({
          value: Mentions.key(item),
          kind: item.kind,
          label: item.label,
          description: item.description,
          icon: appById.get(item.id)?.icon,
        }))
  const ids = items.map((item) => item.value)
  const current = Composer.activeSuggestion(ids, active)
  const tokens = (text: string) => Mentions.tokens(text, connectors)
  const close = () => {
    setTrigger(undefined)
    setActive(undefined)
  }
  const suggest: Suggest = {
    open: trigger !== undefined && (items.length > 0 || apps.searching),
    label: suggestionLabel(trigger, { repositories: repositories.length > 0 }),
    searching: apps.searching,
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
          input.onClient(command.client)
          return { text: "", cursor: 0 }
        }
        const next = `/${command?.trigger ?? value} `
        return { text: next, cursor: next.length }
      }
      const item = mentionable.find((entry) => Mentions.key(entry) === value)
      if (!item || trigger?.kind !== "mention") return
      if (item.kind === "app") apps.choose(item.id)
      return Mentions.insert(text, item, trigger.start, cursor)
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
    unmention: (text, press) => Mentions.remove(text, tokens(text), press),
  }
  return {
    suggest,
    resolve: (text: string) => Mentions.resolve(text, tokens(text)),
  }
}
