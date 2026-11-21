export * as ChatQueries from "./chat-queries.js"

import { canAdministerOptions, organizationOptions } from "./auth.js"
import { pickerPageSize } from "./pagination.js"
import type { Runtime } from "./runtime.js"

export const start = (context: Runtime.Context, organizationId: string | undefined) => [
  context.queryClient.query(
    context.api.agent.list.queryOptions({ page: 1, pageSize: pickerPageSize, isSubagent: false }),
  ),
  context.queryClient.query(canAdministerOptions(context.auth)),
  ...(organizationId ? [context.queryClient.query(organizationOptions(context.auth, organizationId))] : []),
]
