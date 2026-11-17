export * as AppRegistryPages from "./app-registry.js"

import { AppRegistryPages as Shared } from "@ren/client/react"
import { maximumPageSize } from "@ren/schema/pagination"
import type { Runtime } from "./runtime.js"

export const options = Shared.options

export const bySlugs = (api: Runtime.Context["api"], slugs: ReadonlyArray<string>) =>
  api["app-registry"].list.queryOptions({ slugs: [...slugs].toSorted(), page: 1, pageSize: maximumPageSize })

export const all = (api: Runtime.Context["api"]) =>
  api["app-registry"].list.queryOptions({ page: 1, pageSize: maximumPageSize })
