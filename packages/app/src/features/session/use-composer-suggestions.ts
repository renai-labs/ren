import { useState } from "react"
import { ClientCommand, Composer, Mentions } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { AsyncResult } from "effect/reactivity"
import { fromApp, fromRegistry, hasManaged, isBundle, mentionColor, type Status } from "../../lib/apps.js"
import { pageSize, pickerPageSize } from "../../lib/pagination.js"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Repositories } from "../../lib/repositories.js"
import type { MentionMark } from "@ren/ui/mention-overlay"
import { RouterContext } from "../../lib/router-context.js"
import { useSpaceApps } from "./use-space-apps.js"
import {
  categories,
  key,
  useMentionSources,
  useRecent,
  type Category,
  type Entry,
  type Scope,
} from "./use-mention-sources.js"

const noApp = { dependsOn: [], mcps: null, skills: null }

const groupSize = 5
const filePill = /(?<=^|\s)@ {2}([^\s@]*[./][^\s@]*)/g
const recentShown = 3

interface SuggestionItem {
  readonly value: string
  readonly kind: "command" | "category" | "folder" | Mentions.Kind
  readonly label: string
  readonly group?: string | undefined
  readonly description?: string | undefined
  readonly icon?: string | null | undefined
  readonly status?: Status | undefined
  readonly category?: Category["prefix"] | undefined
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
  ) =>
    | {
        text: string
        cursor: number
        focus?: boolean
        mention?: Composer.MentionedApp | undefined
        picked?: Mentions.Token | undefined
        file?: SessionMessage.DriveFile | undefined
      }
    | undefined
  readonly onClose: () => void
  readonly marks: (text: string) => ReadonlyArray<MentionMark & { readonly kind: Mentions.Kind }>
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
  picked: ReadonlyArray<Mentions.Token>
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
    picked: input.picked,
    commands: (query) => ClientCommand.suggestions(client, brain, query),
    onClient: input.onClient,
  })
  return {
    ...core,
    slash: (text: string) => Composer.slash(text, brain),
    client: (text: string) => ClientCommand.parse(client, text),
  }
}

export const useMentionSuggestions = (spaceId: string | undefined, draft: Composer.Draft) =>
  useSuggestions({
    root: undefined,
    spaceId,
    mentions: Composer.mentions(draft),
    picked: Composer.picked(draft),
    commands: () => [],
    onClient: () => undefined,
  })

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
  const own = useQuery(api.app.list.queryOptions({ page: 1, pageSize: pickerPageSize }))
  const found = useQuery({
    ...api["app-registry"].list.queryOptions({ page: 1, pageSize, ...(query && { query }) }),
    enabled: query !== undefined,
    placeholderData: keepPreviousData,
  })
  const ownApps = (own.data?.items ?? []).map(fromApp)
  const managed = new Set([
    ...ownApps.filter(hasManaged).map((app) => app.id),
    ...(found.data?.items ?? []).filter((app) => app.managed).map((app) => app.id),
  ])
  const byId = new Map<string, Composer.MentionedApp>(
    [...ownApps, ...mentions, ...(query === undefined ? [] : (found.data?.items ?? []).map(fromRegistry))].map(
      (app) => [app.id, app],
    ),
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

const scoped = /^(?<prefix>[a-z]+):(?<query>.*)$/u

const scopeOf = (trigger: Composer.Trigger | undefined): Scope | undefined => {
  if (trigger?.kind !== "mention") return undefined
  const parts = scoped.exec(trigger.query)?.groups
  const category = categories.find((each) => each.prefix === parts?.prefix)
  return category ? { category, query: parts?.query ?? "" } : { category: undefined, query: trigger.query }
}

const appQuery = (scope: Scope | undefined) =>
  scope && (!scope.category || scope.category.prefix === "apps") ? scope.query.toLowerCase() : undefined

const pick = (
  scope: Scope | undefined,
  lists: Readonly<Record<Category["prefix"], ReadonlyArray<Entry>>>,
  recent: ReadonlyArray<Entry>,
  offered: ReadonlyArray<Category>,
) => {
  if (!scope) return []
  if (scope.category) return lists[scope.category.prefix]
  if (scope.query === "") return recent.slice(0, recentShown)
  return offered.flatMap((each) => lists[each.prefix].slice(0, groupSize))
}

const headingOf = (scope: Scope | undefined) => {
  if (scope?.category) return scope.category.label
  return scope?.query === "" ? "Recent" : undefined
}

// oxlint-disable-next-line ren/no-comments -- Category rows and drive folders open a list in the menu instead of inserting a mention.
const opening = (scope: Scope | undefined, offered: ReadonlyArray<Category>, folders: ReadonlyArray<Entry>) => {
  if (scope?.category?.prefix === "files")
    return {
      before: folders.map((folder): SuggestionItem => ({
        value: `folder:${folder.item.handle}`,
        kind: "folder",
        label: folder.item.label,
        group: "Files",
      })),
      after: [],
    }
  if (scope && !scope.category && scope.query === "")
    return {
      before: [],
      after: offered.map((each): SuggestionItem => ({
        value: `category:${each.prefix}`,
        kind: "category",
        label: each.label,
        description: each.description,
        category: each.prefix,
      })),
    }
  return { before: [], after: [] }
}

const drill = (item: SuggestionItem | undefined) => {
  if (item?.kind === "folder") return `@files:${item.value.slice("folder:".length)}`
  return item?.kind === "category" ? `@${item.category}:` : undefined
}

const commandItems = (runnable: ReadonlyArray<ClientCommand.Suggestion>) =>
  runnable.map((item): SuggestionItem => ({
    value: item.value,
    kind: "command",
    label: `/${item.trigger}`,
    description: item.description,
    group: "Commands",
  }))

function useSuggestions(input: {
  root: Session.ID | undefined
  spaceId: string | undefined
  mentions: ReadonlyArray<Composer.MentionedApp>
  picked: ReadonlyArray<Mentions.Token>
  commands: (query: string) => ReadonlyArray<ClientCommand.Suggestion>
  onClient: (id: ClientCommand.ID, text: string) => void
}) {
  const [trigger, setTrigger] = useState<Composer.Trigger>()
  const [active, setActive] = useState<string>()
  const scope = scopeOf(trigger)
  const apps = useAppMentions(appQuery(scope), input.mentions)
  const space = useSpaceApps(input.spaceId)
  const appById = apps.byId
  const appEntries = apps.items.map((item): Entry => ({ item, app: apps.mentionOf(item.id) }))
  const repositories = useRepositoryMentions(input.spaceId).map((item): Entry => ({ item }))
  const recent = useRecent(input.spaceId, input.root)
  const sources = useMentionSources({ root: input.root, spaceId: input.spaceId, scope, apps: appEntries, repositories })
  const offered = categories.filter(
    (each) => each.prefix !== "files" || input.spaceId !== undefined || input.root !== undefined,
  )
  const pickable = pick(scope, sources.lists, recent.entries, offered)
  const opened = opening(scope, offered, sources.folders)
  const runnable = trigger?.kind === "command" ? input.commands(trigger.query) : []
  const searching = apps.searching || sources.searching
  const heading = headingOf(scope)
  const mentionItem = (entry: Entry): SuggestionItem => ({
    value: key(entry),
    kind: entry.item.kind,
    group: heading,
    label: entry.item.label,
    description: entry.item.description,
    icon: entry.app?.icon ?? appById.get(entry.item.id)?.icon,
    status:
      entry.item.kind === "app" && input.spaceId && !isBundle(space.app(entry.item.id) ?? noApp)
        ? space.status(entry.item.id, { managed: apps.managed(entry.item.id) })
        : undefined,
  })
  const items =
    trigger?.kind === "command"
      ? commandItems(runnable)
      : [...opened.before, ...pickable.map(mentionItem), ...opened.after]
  const ids = items.map((item) => item.value)
  const current = Composer.activeSuggestion(ids, active)
  const known = [...appEntries, ...repositories, ...sources.agents, ...recent.entries].map((entry) => entry.item)
  const tokens = (text: string) =>
    Mentions.tokens(
      text,
      [
        ...known,
        ...Array.from(text.matchAll(filePill), (match) => Mentions.fromFile({ path: match[1] ?? "", type: "file" })),
      ],
      input.picked,
    )
  const close = () => {
    setTrigger(undefined)
    setActive(undefined)
  }
  const settle = <A extends { readonly text: string; readonly cursor: number }>(next: A) => {
    setTrigger(Composer.trigger(next.text, next.cursor))
    setActive(undefined)
    return next
  }
  const command = (value: string) => {
    close()
    const chosen = runnable.find((item) => item.value === value)
    if (chosen?.client) {
      input.onClient(chosen.client, "")
      return { text: "", cursor: 0, focus: !ClientCommand.leavesComposer(chosen.client) }
    }
    const next = `/${chosen?.trigger ?? value} `
    return { text: next, cursor: next.length }
  }
  const suggest: Suggest = {
    open: trigger !== undefined && (items.length > 0 || searching),
    label: trigger?.kind === "command" ? "Commands" : "Mentions",
    searching,
    items,
    active: current,
    onCursor: (text, cursor) => {
      setTrigger(Composer.trigger(text, cursor))
      setActive(undefined)
    },
    onKey: (press) => {
      if (trigger === undefined || ids.length === 0) return false
      const pressed = Composer.suggestionKey(press, ids, current)
      if (pressed?.type === "close") close()
      if (pressed?.type === "move") setActive(pressed.active)
      return pressed !== undefined && pressed.type !== "select"
    },
    onChoose: (value, text, cursor) => {
      if (trigger?.kind === "command") return command(value)
      if (trigger?.kind !== "mention") return
      const before = text.slice(0, trigger.start)
      const rest = text.slice(cursor)
      const opens = drill(items.find((item) => item.value === value))
      if (opens) return settle({ text: before + opens + rest, cursor: before.length + opens.length })
      const entry = pickable.find((each) => key(each) === value)
      if (!entry) return
      recent.add(entry)
      if (entry.file) return settle({ text: before + rest, cursor: before.length, file: entry.file })
      return settle({
        ...Mentions.insert(text, entry.item, trigger.start, cursor),
        mention: entry.app,
        picked: { start: trigger.start, end: trigger.start + Mentions.text(entry.item).length, item: entry.item },
      })
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
          color: mentionColor,
          file: token.item.kind === "file",
          kind: token.item.kind,
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
    unmention: (text, press) => {
      const back =
        trigger?.kind === "mention" &&
        scope?.category &&
        press.key === "Backspace" &&
        press.selectionStart === press.selectionEnd &&
        text.slice(trigger.start, press.selectionStart) === `@${scope.category.prefix}:`
      if (back)
        return settle({
          text: text.slice(0, trigger.start + 1) + text.slice(press.selectionStart),
          cursor: trigger.start + 1,
        })
      const removed = Mentions.remove(text, tokens(text), press)
      return removed && settle(removed)
    },
  }
  return {
    suggest,
    resolve: (text: string) => Mentions.resolve(text, tokens(text)),
  }
}
