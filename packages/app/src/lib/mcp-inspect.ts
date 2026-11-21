export * as McpInspect from "./mcp-inspect.js"

import type { McpInspectionResult } from "@ren/client"
import { queryOptions } from "@tanstack/react-query"
import { plural } from "./format.js"
import type { Runtime } from "./runtime.js"

export const options = (client: Runtime.Context["client"], url: string) =>
  queryOptions({
    queryKey: ["mcp-inspect", "mcp", "inspect", { url }] as const,
    queryFn: (context) => client["mcp-inspect"].mcp.inspect({ url }, { signal: context.signal }),
    staleTime: 5 * 60_000,
    retry: false,
  })

export const urlOf = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed || /\s/u.test(trimmed)) return
  const parsed = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`)
  const isWeb = parsed?.protocol === "https:" || parsed?.protocol === "http:"
  return isWeb && parsed.hostname.includes(".") ? parsed : undefined
}

export const toolCount = (tools: McpInspectionResult["tools"]) => {
  if (!tools) return
  const read = tools.filter((tool) => tool.readOnly).length
  return [plural(tools.length, "tool"), `${read} read`, `${tools.length - read} write`].join(" · ")
}

export const noTools = (result: McpInspectionResult | undefined) => {
  if (!result || !result.reachable) return "Couldn’t reach the server to list its tools."
  if (result.auth.type === "none") return "The server lists no tools."
  return "Tools show after you sign in."
}
