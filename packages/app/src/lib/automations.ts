export * as Automations from "./automations.js"

import { Schema } from "effect"
import { Loader } from "./loader.js"
import { Pages } from "./pages.js"
import type { Runtime } from "./runtime.js"
import { scheduleListInput, scheduleSearchFields } from "./schedules.js"
import { Webhooks } from "./webhooks.js"

const SearchSchema = Schema.Struct({ ...scheduleSearchFields, kind: Schema.optional(Schema.Literals(["webhooks"])) })

export type Search = typeof SearchSchema.Type

export const Search = Schema.toStandardSchemaV1(SearchSchema)

export const loaderDeps = (options: { readonly search: Search }) => ({
  kind: options.search.kind,
  filters: options.search.filters,
})

export const preload = (context: Runtime.Context, deps: Search, spaceId?: string) =>
  Loader.start(
    deps.kind === "webhooks"
      ? context.queryClient.query(context.api.webhook.list.queryOptions(Webhooks.listInput(spaceId)))
      : context.queryClient.infiniteQuery(Pages.schedules(context.client, scheduleListInput(deps, { spaceId }))),
  )
