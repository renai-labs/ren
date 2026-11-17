import { useState } from "react"
import { ClientCommand, Composer, Mentions } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { Session } from "@ren/schema/session"
import { AsyncResult } from "effect/reactivity"
import { MentionSources } from "@ren/client/react"
import { isBundle, mentionColor, type Status } from "../../lib/apps.js"
import type { MentionMark } from "@ren/ui/mention-overlay"
import { RouterContext } from "../../lib/router-context.js"
import { useSpaceApps } from "./use-space-apps.js"

const noApp = { dependsOn: [], mcps: null, skills: null }

interface SuggestionItem {
  readonly value: string
  readonly kind: "command" | Mentions.Kind
  readonly label: string
  readonly group?: Mentions.Group | undefined
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

const suggestionLabel = (trigger: Composer.Trigger | undefined) =>
  trigger?.kind === "command" ? "Commands" : "Mentions"

const mentionItem = (
  entry: ReturnType<typeof Mentions.group>[number],
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
  const { api } = RouterContext.useRouterContext()
  const apps = MentionSources.useApps(api, { query, mentions: input.mentions })
  const space = useSpaceApps(input.spaceId)
  const appById = apps.byId
  const repositories = MentionSources.useRepositories(api, input.spaceId).map(Mentions.fromRepository)
  const found = ChatReact.useFileMentions(input.root, query)
  const appItems = apps.apps.map(Mentions.fromApp)
  const connectors = [...appItems, ...repositories]
  const runnable = trigger?.kind === "command" ? input.commands(trigger.query) : []
  const searching = apps.searching || found.searching
  const grouped = query === undefined ? [] : Mentions.group(query, { apps: appItems, repositories, files: found.items })
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
            entry.item.kind === "app" && input.spaceId && !isBundle(space.app(entry.item.id) ?? noApp)
              ? space.status(entry.item.id, { managed: apps.managed(entry.item.id) })
              : undefined,
          ),
        )
  const ids = items.map((item) => item.value)
  const current = Composer.activeSuggestion(ids, active)
  const tokens = (text: string) => Mentions.scan(text, connectors)
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
          file: token.item.kind === "file",
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
