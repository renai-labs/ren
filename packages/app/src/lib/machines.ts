export * as Machines from "./machines.js"

import type { EnvironmentTemplateInfo } from "@ren/client"
import { queryOptions } from "@tanstack/react-query"
import { pickerPageSize } from "./pagination.js"
import type { Runtime } from "./runtime.js"

const key = () => ["environment-template", "all"] as const

export const options = (client: Runtime.Context["client"]) =>
  queryOptions({
    queryKey: key(),
    queryFn: async (context) => {
      const items: EnvironmentTemplateInfo[] = []
      for (let page = 1; ; page++) {
        // oxlint-disable-next-line no-await-in-loop -- Load every page so machine pickers and settings do not stop at the first 50 templates.
        const result = await client["environment-template"].list(
          { page, pageSize: pickerPageSize },
          { signal: context.signal },
        )
        items.push(...result.items)
        if (page * result.pageSize >= result.total || result.items.length === 0) return items
      }
    },
  })
