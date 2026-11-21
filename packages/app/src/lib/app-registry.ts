export * as AppRegistryLists from "./app-registry.js"

import { maximumPageSize } from "@ren/schema/pagination"
import type { Runtime } from "./runtime.js"

export const bySlugs = (api: Runtime.Context["api"], slugs: ReadonlyArray<string>) =>
  api["app-registry"].list.queryOptions({ slugs: [...slugs].toSorted(), page: 1, pageSize: maximumPageSize })

export const all = (api: Runtime.Context["api"]) =>
  api["app-registry"].list.queryOptions({ page: 1, pageSize: maximumPageSize })
