export * as Artifacts from "./artifacts.js"

import type { ArtifactInfo } from "@ren/client"
import { queryOptions } from "@tanstack/react-query"
import { Schema } from "effect"
import { pickerPageSize } from "./pagination.js"
import type { Runtime } from "./runtime.js"

const views = ["gallery", "list"] as const

export type View = (typeof views)[number]

const sorts = ["updated", "name"] as const

export type Sort = (typeof sorts)[number]

export const sortLabels: Readonly<Record<Sort, string>> = { updated: "Recently updated", name: "Name" }

const SearchSchema = Schema.Struct({
  q: Schema.optional(Schema.String),
  view: Schema.optional(Schema.Literals(views)),
  sort: Schema.optional(Schema.Literals(sorts)),
  filters: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.String))),
  collapsed: Schema.optional(Schema.Array(Schema.String)),
})

export type Search = typeof SearchSchema.Type

export const Search = Schema.toStandardSchemaV1(SearchSchema)

export const isView = (value: unknown): value is View => views.some((view) => view === value)

export const isSort = (value: unknown): value is Sort => sorts.some((sort) => sort === value)

const refreshEvery = 5000

const allKey = (spaceId?: string) =>
  spaceId === undefined ? (["artifact", "all"] as const) : (["artifact", "all", { spaceId }] as const)

export const allOptions = (client: Runtime.Context["client"], spaceId?: string) =>
  queryOptions({
    queryKey: allKey(spaceId),
    queryFn: async (context) => {
      const items: ArtifactInfo[] = []
      for (let page = 1; ; page++) {
        // oxlint-disable-next-line no-await-in-loop -- pages fetched in order until total reached
        const result = await client.artifact.list(
          { ...(spaceId && { spaceId }), page, pageSize: pickerPageSize },
          { signal: context.signal },
        )
        items.push(...result.items)
        if (page * result.pageSize >= result.total || result.items.length === 0) return items
      }
    },
    refetchInterval: (query) =>
      query.state.data?.some((artifact) => artifact.activeDeploymentId !== null) ? refreshEvery : false,
  })

export const host = (url: string | null) => (url === null ? undefined : URL.parse(url)?.host)

export type Mention = { readonly id: string; readonly title: string }

const whitespace = /\s/
const word = /[\p{L}\p{N}_]/u

export const mentionRanges = (text: string, artifact?: Mention) => {
  if (!artifact?.title) return []
  const mention = `@${artifact.title}`
  return [...text.matchAll(/@/g)]
    .map((match) => ({ start: match.index, end: match.index + mention.length }))
    .filter(
      (range) =>
        text.startsWith(mention, range.start) &&
        (range.start === 0 || whitespace.test(text.charAt(range.start - 1))) &&
        (range.end === text.length || !word.test(text.charAt(range.end))),
    )
}

export const resolveMention = (text: string, artifact?: Mention) => {
  if (!artifact) return text
  return mentionRanges(text, artifact).reduceRight(
    (resolved, range) => `${resolved.slice(0, range.end)} (artifact ID: ${artifact.id})${resolved.slice(range.end)}`,
    text,
  )
}
