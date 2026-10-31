export * as AppCatalog from "./app-catalog.js"

import { Schema } from "effect"
import { App } from "./app.js"
import { AppProfile } from "./app-profile.js"
import { Credential } from "./credential.js"
import { Mcp } from "./mcp.js"
import { Primitive } from "./primitive.js"
import { Skill } from "./skill.js"

export interface Profile extends Schema.Schema.Type<typeof Profile> {}
export const Profile = Schema.Struct({
  id: AppProfile.ID,
  slug: AppProfile.Slug,
  name: Primitive.Name,
  kind: AppProfile.Kind,
}).annotate({ identifier: "AppCatalog.Profile" })

export interface AppEntry extends Schema.Schema.Type<typeof AppEntry> {}
export const AppEntry = Schema.Struct({
  appId: App.ID,
  appSlug: Primitive.Slug,
  name: Primitive.Name,
  profiles: Schema.Array(
    Schema.Struct({
      slug: AppProfile.Slug,
      name: Primitive.Name,
      kind: AppProfile.Kind,
      env: Schema.Record(Credential.EnvName, Credential.EnvName).annotate({
        description: "Each connected env key of the profile, mapped to its label.",
      }),
    }),
  ),
}).annotate({ identifier: "AppCatalog.AppEntry" })

export interface McpEntry extends Schema.Schema.Type<typeof McpEntry> {}
export const McpEntry = Schema.Struct({
  appId: App.ID,
  appSlug: Primitive.Slug,
  slug: Primitive.Slug,
  declaration: Mcp.Declaration,
  server: Schema.String.annotate({ description: "The server name: `<mcp>__<profile>`, or `<mcp>` for auth none." }),
  profile: Schema.NullOr(Profile).annotate({ description: "Null for an MCP with auth none." }),
  label: Schema.NullOr(Credential.EnvName).annotate({ description: "The label of the item’s credential." }),
  env: Schema.optionalKey(
    Schema.Record(Credential.EnvName, Schema.String).annotate({
      description: "For a local server: each env key it needs, mapped to the profile’s placeholder.",
    }),
  ),
  url: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "For a provider MCP: the address to call, the provider’s host with the first path segment `ren:<label>`. For a managed MCP: `<integrations URL>/<server>/mcp`.",
    }),
  ),
}).annotate({ identifier: "AppCatalog.McpEntry" })

export interface SkillEntry extends Schema.Schema.Type<typeof SkillEntry> {}
export const SkillEntry = Schema.Struct({
  appId: App.ID,
  appSlug: Primitive.Slug,
  slug: Primitive.Slug,
  declaration: Skill.Declaration,
}).annotate({ identifier: "AppCatalog.SkillEntry" })

export interface Unavailable extends Schema.Schema.Type<typeof Unavailable> {}
export const Unavailable = Schema.Struct({
  appSlug: Primitive.Slug,
  mcp: Primitive.Slug,
  profile: Schema.NullOr(Primitive.Name).annotate({ description: "The profile’s display name." }),
  reason: Schema.Literals(["provider", "egress", "integrations"]),
}).annotate({
  identifier: "AppCatalog.Unavailable",
  description:
    "An MCP that Ren leaves out: its provider is not set up on this Ren, the brain cannot reach credentials, or this Ren has no integrations service.",
})

export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export const Catalog = Schema.Struct({
  apps: Schema.Array(AppEntry),
  mcps: Schema.Array(McpEntry),
  skills: Schema.Array(SkillEntry),
  unavailable: Schema.Array(Unavailable),
}).annotate({ identifier: "AppCatalog.Catalog" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({ fingerprint: Schema.String, catalog: Catalog }).annotate({
  identifier: "AppCatalog.Info",
})

export interface Naming {
  readonly normalize: (slug: string) => string
  readonly reserved: ReadonlyArray<{ readonly kind: "skills" | "mcps"; readonly slug: string; readonly source: string }>
}

export const nameConflicts = (catalog: Catalog, naming: Naming): ReadonlyArray<string> => {
  const sources = [
    ...naming.reserved,
    ...catalog.skills.map((entry) => ({
      kind: "skills" as const,
      slug: entry.slug,
      source: `${entry.appSlug} (${entry.appId})/skills/${entry.slug}`,
    })),
    ...catalog.mcps.map((entry) => ({
      kind: "mcps" as const,
      slug: entry.server,
      source: `${entry.appSlug} (${entry.appId})/mcps/${entry.server}`,
    })),
  ]
  return [...Map.groupBy(sources, (entry) => `${entry.kind}/${naming.normalize(entry.slug)}`).entries()].flatMap(
    ([name, entries]) =>
      entries.length > 1
        ? [`Component name collision at ${name}: ${entries.map((entry) => entry.source).join(" and ")}.`]
        : [],
  )
}
