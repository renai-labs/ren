import { Composer, Mentions } from "@ren/chat"
import { ChatReact } from "@ren/chat/react"
import { MentionSources, SpaceApps } from "@ren/client/react"
import type { Session } from "@ren/schema/session"
import { Slug } from "@ren/util/slug"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Api } from "#lib/api"

const slugOf = (text: string) => Slug.of(text, 32)

export interface Suggestion {
  readonly value: string
  readonly kind: Mentions.Kind
  readonly label: string
  readonly group: Mentions.Group
  readonly description: string | undefined
  readonly icon: string | null | undefined
}

export interface Suggestions {
  readonly open: boolean
  readonly searching: boolean
  readonly items: ReadonlyArray<Suggestion>
  readonly selection: { readonly start: number; readonly end: number } | undefined
  readonly onCursor: (cursor: number) => void
  readonly onChoose: (value: string) => void
  readonly onClose: () => void
}

export function useMentions(input: {
  readonly root: Session.ID | undefined
  readonly spaceId: string | undefined
  readonly draft: Composer.Draft
  readonly update: (change: (draft: Composer.Draft) => Composer.Draft) => void
  readonly onError: (message: string) => void
}) {
  const draft = input.draft
  const [cursor, setCursor] = useState(draft.text.length)
  const [selection, setSelection] = useState<{ readonly start: number; readonly end: number }>()
  const [closed, setClosed] = useState(false)
  const trigger = Composer.trigger(draft.text, cursor)
  const query = trigger?.kind === "mention" ? trigger.query.toLowerCase() : undefined
  const apps = MentionSources.useApps(Api.query, { query, mentions: Composer.mentions(draft) })
  const repositories = MentionSources.useRepositories(Api.query, input.spaceId).map(Mentions.fromRepository)
  const files = ChatReact.useFileMentions(input.root, query)
  const space = useQuery({
    ...Api.query.space.get.queryOptions({ idOrSlug: input.spaceId ?? "" }),
    enabled: input.spaceId !== undefined,
  })
  const accounts = SpaceApps.useAccounts(Api.query, slugOf)
  const appItems = apps.apps.map(Mentions.fromApp)
  const connectors = [...appItems, ...repositories]
  const tokens = (text: string) => Mentions.scan(text, connectors)
  const mentioned = [
    ...new Map(
      tokens(draft.text).flatMap((token) => {
        const app = token.item.kind === "app" ? apps.mentionOf(token.item.id) : undefined
        return app ? [[app.id, app] as const] : []
      }),
    ).values(),
  ]
  const status = SpaceApps.useSpace(Api.query, {
    spaceId: input.spaceId,
    space: space.data,
    appIds: mentioned.map((app) => app.id),
  })
  const grouped = query === undefined ? [] : Mentions.group(query, { apps: appItems, repositories, files: files.items })
  const searching = apps.searching || files.searching
  const suggestions: Suggestions = {
    open: !closed && query !== undefined && (grouped.length > 0 || searching),
    searching,
    items: grouped.map((entry) => ({
      value: Mentions.key(entry.item),
      kind: entry.item.kind,
      label: entry.item.label,
      group: entry.group,
      description: entry.item.description,
      icon: apps.byId.get(entry.item.id)?.icon,
    })),
    selection,
    onCursor: (next) => {
      if (next !== cursor) setClosed(false)
      setCursor(next)
      setSelection(undefined)
    },
    onChoose: (value) => {
      const item = grouped.find((entry) => Mentions.key(entry.item) === value)?.item
      if (!item || trigger?.kind !== "mention") return
      const inserted = Mentions.insert(draft.text, item, trigger.start, cursor)
      const app = item.kind === "app" ? apps.mentionOf(item.id) : undefined
      input.update((current) => {
        const next = Composer.withText(current, inserted.text)
        return app ? Composer.withMention(next, app) : next
      })
      setCursor(inserted.cursor)
      setSelection({ start: inserted.cursor, end: inserted.cursor })
    },
    onClose: () => setClosed(true),
  }
  return {
    suggestions,
    mentioned,
    change: (text: string) => {
      const removal = Mentions.unmention(draft.text, text, tokens(draft.text))
      const next = removal?.text ?? text
      const at = removal?.cursor ?? Math.max(0, Math.min(next.length, cursor + next.length - draft.text.length))
      input.update((current) => Composer.withText(current, next))
      setCursor(at)
      setSelection(removal ? { start: at, end: at } : undefined)
      setClosed(false)
    },
    mention: (app: Composer.MentionedApp) => {
      const inserted = Mentions.insertAt(draft.text, Mentions.fromApp(app), Math.min(cursor, draft.text.length))
      input.update((current) => Composer.withMention(Composer.withText(current, inserted.text), app))
      setCursor(inserted.cursor)
      setSelection({ start: inserted.cursor, end: inserted.cursor })
      setClosed(true)
    },
    resolve: (text: string) => Mentions.resolve(text, tokens(text)),
    prepare: async () => {
      const from = status.from
      if (status.pending || !from) return
      const missing = mentioned.flatMap((each) => {
        const app = status.app(each.id)
        return app && status.status(app.id) === "credits" && status.here(app.id).length === 0 ? [app] : []
      })
      await Promise.all(
        missing.map((app) =>
          accounts
            .addManaged(app, from)
            .catch(() => input.onError(`Couldn’t add ${app.name} to ${from.name}. Ren may not be able to use it.`)),
        ),
      )
    },
  }
}
