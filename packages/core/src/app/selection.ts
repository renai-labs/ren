export * as AppSelection from "./selection.js"

import type { AppCatalog } from "@ren/schema/app-catalog"
import { Option, Struct } from "effect"
import { ProfileLabel } from "./profile-label.js"

export const integrationsLabel = "INTEGRATIONS"

export type Candidate = Pick<AppCatalog.McpEntry, "appId" | "appSlug" | "slug" | "declaration">

// oxlint-disable-next-line ren/no-comments -- integrations spec §5.1: a managed MCP is on until a connected official server of its app replaces it. Every input comes from the resolve inputs that the fingerprint hashes, so a change reaches the brain in one pull.
export const select = (input: {
  readonly resolved: ReadonlyArray<AppCatalog.McpEntry>
  readonly managed: ReadonlyArray<Candidate>
  readonly integrationsUrl: Option.Option<string>
  readonly egress: boolean
}): {
  readonly mcps: ReadonlyArray<AppCatalog.McpEntry>
  readonly unavailable: ReadonlyArray<AppCatalog.Unavailable>
} => {
  const kept = input.managed.flatMap((candidate) => {
    const transport = candidate.declaration.transport
    if (transport.type !== "managed") return []
    const replaces = transport.replaces
    if (replaces && input.resolved.some((entry) => entry.appId === candidate.appId && entry.slug === replaces))
      return []
    return [{ candidate, server: transport.server }]
  })
  const unavailable = (reason: AppCatalog.Unavailable["reason"]) => ({
    mcps: input.resolved,
    unavailable: kept.map((each) => ({
      appSlug: each.candidate.appSlug,
      mcp: each.candidate.slug,
      profile: null,
      reason,
    })),
  })
  if (Option.isNone(input.integrationsUrl)) return unavailable("managed")
  if (!input.egress) return unavailable("egress")
  const base = input.integrationsUrl.value.replace(/\/$/u, "")
  return {
    mcps: [
      ...input.resolved,
      ...kept.map((each): AppCatalog.McpEntry =>
        Struct.assign(each.candidate, {
          server: ProfileLabel.serverOf(each.candidate.slug),
          profile: null,
          label: integrationsLabel,
          url: `${base}/${each.server}/mcp`,
        }),
      ),
    ],
    unavailable: [],
  }
}
