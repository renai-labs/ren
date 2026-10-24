export * as AppCatalog from "./app-catalog.js"

import { Schema } from "effect"
import { App } from "./app.js"
import { AppRelease } from "./app-release.js"
import { Credential } from "./credential.js"
import { Mcp } from "./mcp.js"
import { Primitive } from "./primitive.js"
import { Skill } from "./skill.js"

export interface Provenance extends Schema.Schema.Type<typeof Provenance> {}
export const Provenance = Schema.Struct({
  appId: App.ID,
  releaseId: AppRelease.ID,
  appSlug: Primitive.Slug,
  version: AppRelease.Version,
}).annotate({ identifier: "AppCatalog.Provenance" })

export interface McpEntry extends Schema.Schema.Type<typeof McpEntry> {}
export const McpEntry = Schema.Struct({
  ...Provenance.fields,
  slug: Primitive.Slug,
  declaration: Mcp.Declaration,
}).annotate({ identifier: "AppCatalog.McpEntry" })

export interface SkillEntry extends Schema.Schema.Type<typeof SkillEntry> {}
export const SkillEntry = Schema.Struct({
  ...Provenance.fields,
  slug: Primitive.Slug,
  declaration: Skill.Declaration,
}).annotate({ identifier: "AppCatalog.SkillEntry" })

export interface Catalog extends Schema.Schema.Type<typeof Catalog> {}
export const Catalog = Schema.Struct({
  apps: Schema.Array(Provenance),
  mcps: Schema.Array(McpEntry),
  skills: Schema.Array(SkillEntry),
  credentials: Schema.Array(Schema.Struct({ appId: App.ID, requirements: Schema.Array(Credential.Requirement) })),
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
    ...(["skills", "mcps"] as const).flatMap((kind) =>
      catalog[kind].map((entry) => ({
        kind,
        slug: entry.slug,
        source: `${entry.appSlug}@${entry.version} (${entry.appId}/${entry.releaseId})/${kind}/${entry.slug}`,
      })),
    ),
  ]
  return [...Map.groupBy(sources, (entry) => `${entry.kind}/${naming.normalize(entry.slug)}`).entries()].flatMap(
    ([name, entries]) =>
      entries.length > 1
        ? [`Component name collision at ${name}: ${entries.map((entry) => entry.source).join(" and ")}.`]
        : [],
  )
}
