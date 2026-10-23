export * as SessionSummary from "./session-summary.js"

import { Ren } from "@ren/client/chat"
import type { FormInfo, PermissionRequest } from "@ren/client/chat"
import { queryOptions } from "@tanstack/react-query"
import type { Runtime } from "./runtime.js"

export async function client(context: Runtime.Context, sessionID: string) {
  const access = await context.queryClient.query({
    // ast-grep-ignore: no-query-key-literal -- short-lived access tokens are shared between lightweight session reads
    queryKey: [...context.api.chat.access.mutationKey(), sessionID],
    queryFn: () => context.client.chat.access({ id: sessionID }),
    staleTime: (query) => (query.state.data?.status === "ready" ? 30_000 : 0),
  })
  if (access.status !== "ready") return
  return Ren.make({
    baseUrl: access.url,
    headers: { authorization: `Bearer ${access.token}` },
    fetch: context.platform.fetch,
  })
}

export function attentionOptions(context: Runtime.Context, sessionID: string) {
  return queryOptions({
    // ast-grep-ignore: no-query-key-literal -- this lightweight chat read is scoped to the generated session key
    queryKey: [...context.api.session.get.queryKey({ idOrSlug: sessionID }), "attention"],
    queryFn: async (input) => {
      const chat = await client(context, sessionID)
      if (!chat) return { form: undefined, permission: undefined, reason: undefined }
      const read = async (
        id: string,
      ): Promise<{ form: FormInfo | undefined; permission: PermissionRequest | undefined }> => {
        const [forms, permissions, children] = await Promise.all([
          chat.session.form.list({ sessionID: id }, { signal: input.signal }),
          chat.session.permission.list({ sessionID: id }, { signal: input.signal }),
          chat.session.children({ sessionID: id }, { signal: input.signal }),
        ])
        if (forms[0] || permissions[0]) return { form: forms[0], permission: permissions[0] }
        const descendants = await Promise.all(children.map((child) => read(child.id)))
        return {
          form: descendants.find((child) => child.form)?.form,
          permission: descendants.find((child) => child.permission)?.permission,
        }
      }
      const found = await read(sessionID)
      return { ...found, reason: found.form?.title ?? (found.permission ? "Permission needed" : undefined) }
    },
    refetchInterval: 5000,
  })
}

export function previewOptions(context: Runtime.Context, sessionID: string) {
  return queryOptions({
    // ast-grep-ignore: no-query-key-literal -- previews share the generated session invalidation prefix
    queryKey: [...context.api.session.get.queryKey({ idOrSlug: sessionID }), "preview"],
    queryFn: async (input) => {
      const result = await context.client.chat.messages({ id: sessionID, limit: 20 }, { signal: input.signal })
      const message = result.items.findLast((entry) => entry.type === "assistant")
      return (
        message?.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join(" ") ?? ""
      )
    },
    refetchInterval: 5000,
  })
}
