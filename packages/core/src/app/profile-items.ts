export * as ProfileItems from "./profile-items.js"

import type { App } from "@ren/schema/app"
import type { AppProfile } from "@ren/schema/app-profile"
import type { Credential } from "@ren/schema/credential"
import type { Mcp } from "@ren/schema/mcp"
import { ProfileLabel } from "./profile-label.js"

export interface Declared {
  readonly item: Credential.Item
  readonly kind: Credential.RequirementKind
  readonly label: string
  readonly name: string
  readonly optional: boolean
  readonly madeFor: string
  readonly mcp?: Mcp.Declaration
}

export interface Row {
  readonly id: Credential.ID
  readonly label: string
  readonly type: Credential.Type
  readonly status: Credential.Status
  readonly scopes: ReadonlyArray<string>
  readonly field_names: ReadonlyArray<string>
  readonly made_for: string | null
  readonly account_user_id: string | null
}

const hash = (fields: ReadonlyArray<string | null>) =>
  new Bun.CryptoHasher("sha256").update(JSON.stringify(fields)).digest("hex")

// oxlint-disable-next-line ren/no-comments -- §12 rule 3 (P34): the parts of a declaration that a token is bound to. A header rename or a new scope is not among them.
export const madeFor = (declaration: Mcp.Declaration | undefined) => {
  if (!declaration) return hash(["env"])
  const auth = declaration.auth
  const transport = declaration.transport
  if (transport.type === "provider") return hash([auth.type, "provider", transport.provider, transport.integration])
  if (auth.type === "oauth")
    return hash([
      auth.type,
      transport.type === "remote" ? transport.url : null,
      auth.client?.clientId ?? null,
      auth.client?.resource ?? null,
    ])
  return hash([auth.type])
}

const kindOf = (declaration: Mcp.Declaration): Credential.RequirementKind | undefined => {
  if (declaration.auth.type === "none") return undefined
  if (declaration.transport.type === "provider") return "provider"
  return declaration.auth.type === "oauth" ? "oauth" : "fields"
}

const scopesOf = (declaration: Mcp.Declaration) =>
  declaration.auth.type === "oauth" ? (declaration.auth.scopes ?? []) : []

export const fieldsOf = (declaration: Mcp.Declaration) => {
  const auth = declaration.auth
  if (auth.type === "header") return [auth.credential]
  if (auth.type === "basic") return [auth.username, auth.password]
  return []
}

// oxlint-disable-next-line ren/no-comments -- §9 rule 4: one item per MCP whose auth is not none, sorted by slug, then one per env key of the app, its skills and its local MCPs, merged by name. A key is optional only when every declaration of it is.
export const declared = (definition: Pick<App.Definition, "mcps" | "skills" | "requiredCredentials">, slug: string) => {
  const mcps = Object.entries(definition.mcps).toSorted(([left], [right]) => left.localeCompare(right))
  const envs = [
    ...definition.requiredCredentials,
    ...Object.values(definition.skills).flatMap((skill) => skill.requiredCredentials),
    ...mcps.flatMap(([, mcp]) => (mcp.transport.type === "local" ? mcp.requiredCredentials : [])),
  ].flatMap((requirement) => (requirement.kind === "env" ? [requirement] : []))
  const byName = Map.groupBy(envs, (requirement) => requirement.name)
  return [
    ...mcps.flatMap(([mcp, declaration]): ReadonlyArray<Declared> => {
      const kind = kindOf(declaration)
      if (!kind) return []
      return [
        {
          item: { mcp },
          kind,
          label: ProfileLabel.labelOf({ mcp }, slug),
          name: declaration.name,
          optional: false,
          madeFor: madeFor(declaration),
          mcp: declaration,
        },
      ]
    }),
    ...[...byName.entries()].map(([env, requirements]): Declared => ({
      item: { env },
      kind: "env",
      label: ProfileLabel.labelOf({ env }, slug),
      name: env,
      optional: requirements.every((requirement) => requirement.optional),
      madeFor: madeFor(undefined),
    })),
  ]
}

export const oauthApps = (definition: Pick<App.Definition, "mcps" | "requiredCredentials">) => [
  ...new Set(
    [...definition.requiredCredentials, ...Object.values(definition.mcps).flatMap((mcp) => mcp.requiredCredentials)]
      .filter((requirement) => requirement.kind === "oauth_app")
      .map((requirement) => requirement.name),
  ),
]

// oxlint-disable-next-line ren/no-comments -- §12 rules 4 to 7: another binding hash or a declared scope the credential lacks gives reconnect; a dropped scope changes nothing. A declared field the credential lacks gives missing.
export const statusOf = (
  item: Declared,
  row: Row | undefined,
  options: { readonly isProviderSetUp: boolean },
): AppProfile.ItemStatus => {
  if (item.kind === "provider" && !options.isProviderSetUp) return "unavailable"
  if (!row) return "missing"
  const declaration = item.mcp
  if (!declaration) return row.status === "reconnect" ? "reconnect" : "ok"
  if (row.type === "fields" && fieldsOf(declaration).some((field) => !row.field_names.includes(field))) return "missing"
  const isStale =
    row.status === "reconnect" ||
    row.made_for !== item.madeFor ||
    scopesOf(declaration).some((scope) => !row.scopes.includes(scope))
  return isStale ? "reconnect" : "ok"
}

export const isGap = (item: Declared, status: AppProfile.ItemStatus) => status !== "ok" && !item.optional
