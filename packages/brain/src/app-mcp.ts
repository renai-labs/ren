export * as AppMcp from "./app-mcp.js"

import type { AppCatalog } from "@ren/schema/app-catalog"
import { Credential } from "@ren/schema/credential"
import { Mcp } from "@ren/schema/mcp"
import { Option } from "effect"

export interface Remote {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly sendsSpeaker: boolean
}

// oxlint-disable-next-line ren/no-comments -- §6.4 rule 3: a sign-in sends its token as a Bearer placeholder, a bearer or header MCP its pasted field in its header. A basic credential needs no placeholder: the egress sets its header by host. A managed MCP sends the integrations placeholder.
const headersOf = (entry: AppCatalog.McpEntry): Readonly<Record<string, string>> => {
  const auth = entry.declaration.auth
  if (!entry.label) return {}
  if (entry.declaration.transport.type === "managed" || auth.type === "oauth")
    return { Authorization: `Bearer ${Credential.placeholder(entry.label)}` }
  if (auth.type === "bearer") return { Authorization: `Bearer ${Credential.placeholder(entry.label, auth.credential)}` }
  if (auth.type === "header") return { [auth.name]: Credential.placeholder(entry.label, auth.credential) }
  return {}
}

// oxlint-disable-next-line ren/no-comments -- A query MCP sends its pasted field as a query parameter of its URL; the egress replaces it there.
const urlOf = (entry: AppCatalog.McpEntry, url: string) => {
  const auth = entry.declaration.auth
  if (!entry.label || auth.type !== "query") return url
  const withKey = new URL(url)
  withKey.searchParams.set(auth.name, Credential.placeholder(entry.label, auth.credential))
  return withKey.toString()
}

// oxlint-disable-next-line ren/no-comments -- How a brain calls an MCP that does not run in its environment. A managed MCP also sends its speaker (integrations spec §5.1).
export const remoteOf = (entry: AppCatalog.McpEntry): Option.Option<Remote> => {
  const transport = entry.declaration.transport
  const url = Mcp.Transport.match(transport, {
    local: () => undefined,
    remote: (remote) => remote.url,
    provider: () => entry.url,
    managed: () => entry.url,
  })
  return url
    ? Option.some({ url: urlOf(entry, url), headers: headersOf(entry), sendsSpeaker: transport.type === "managed" })
    : Option.none()
}

export const descriptionOf = (entry: AppCatalog.McpEntry): Option.Option<string> => {
  if (entry.declaration.transport.type === "managed")
    return Option.some(`${entry.declaration.name}, paid with Ren credits`)
  return Option.map(
    Option.fromNullishOr(entry.profile),
    (profile) => `${entry.declaration.name} for the profile “${profile.name}”`,
  )
}
