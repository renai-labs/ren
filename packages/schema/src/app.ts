export * as App from "./app.js"

import { Effect, Schema } from "effect"
import { Auth } from "./auth.js"
import { AppIdentity } from "./app/identity.js"
import { Credential } from "./credential.js"
import { Mcp } from "./mcp.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Skill } from "./skill.js"
import { Space } from "./space.js"
import { Webhook } from "./webhook.js"

export const ID = AppIdentity.ID
export type ID = typeof ID.Type

const packageList = (title: string, example: string) =>
  Schema.optionalKey(Schema.Array(Schema.NonEmptyString).annotate({ title, examples: [[example]] }))

export interface Packages extends Schema.Schema.Type<typeof Packages> {}
export const Packages = Schema.Struct({
  apt: packageList("APT packages", "ffmpeg"),
  npm: packageList("npm packages", "typescript"),
  pip: packageList("pip packages", "requests"),
  go: packageList("Go modules", "golang.org/x/tools/gopls@latest"),
}).annotate({ identifier: "App.Packages", title: "Packages", description: "One per line." })

export interface Environment extends Schema.Schema.Type<typeof Environment> {}
export const Environment = Schema.Struct({
  packages: Packages.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  buildCommands: Schema.Array(Schema.NonEmptyString.check(Schema.isMaxLength(4096)))
    .check(Schema.isMaxLength(50))
    .annotate({
      title: "Build commands",
      description: "Run in order after the packages. One per line.",
      examples: [["corepack enable"]],
    })
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
}).annotate({ identifier: "App.Environment" })

export interface Definition extends Schema.Schema.Type<typeof Definition> {}
export const Definition = Schema.Struct({
  requiredCredentials: Schema.Array(Credential.Requirement).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
  environment: Schema.optionalKey(Environment),
  skills: Schema.Record(Primitive.Slug, Skill.Declaration).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  mcps: Schema.Record(Primitive.Slug, Mcp.Declaration)
    .check(
      Schema.makeFilter((mcps) =>
        Object.entries(mcps).flatMap(([slug, mcp]) => {
          const replaces = mcp.transport.type === "managed" ? mcp.transport.replaces : undefined
          return replaces && (mcps[replaces]?.auth.type ?? "none") === "none"
            ? [
                {
                  path: [slug, "transport", "replaces"],
                  issue: `The managed MCP replaces "${replaces}", which is not an MCP of this app with auth.`,
                },
              ]
            : []
        }),
      ),
    )
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  dependsOn: Schema.Array(Primitive.Slug).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
  webhooks: Schema.Record(Primitive.Slug, Webhook.Preset)
    .annotate({
      description: "Webhooks that a space can turn on. Each one reads its name, message and parser from here.",
    })
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
}).annotate({ identifier: "App.Definition", description: "The app’s content. One per app; an edit replaces it." })

export interface Metadata extends Schema.Schema.Type<typeof Metadata> {}
export const Metadata = Schema.Struct({
  name: Primitive.Name,
  description: Schema.NonEmptyString,
  icon: Schema.optionalKey(Primitive.HttpsUrl),
}).annotate({ identifier: "App.Metadata" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  slug: Primitive.Slug,
  organizationId: Schema.NullOr(Auth.OrganizationID),
  ownerSpaceId: Schema.NullOr(Space.ID),
  name: Primitive.Name,
  description: Schema.NonEmptyString,
  icon: Schema.NullOr(Schema.String),
  ...Definition.fields,
  mcps: Schema.Record(Primitive.Slug, Mcp.Info),
  skills: Schema.Record(Primitive.Slug, Skill.Info),
  revision: Schema.Int.annotate({ description: "Counts the edits of the definition." }),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "App.Info" })

export interface Declaration extends Schema.Schema.Type<typeof Declaration> {}
export const Declaration = Schema.Struct({
  ...Metadata.fields,
  ...Definition.fields,
}).annotate({ identifier: "App.Declaration" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  ...Declaration.fields,
  icon: Schema.optional(Primitive.HttpsUrl),
  environment: Schema.optional(Environment),
  slug: Primitive.Slug,
  ownerSpaceId: Space.ID,
}).annotate({ identifier: "App.CreateInput" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  ...Definition.fields,
  environment: Schema.optional(Environment),
  name: Schema.optional(Primitive.Name),
  description: Schema.optional(Schema.NonEmptyString),
  icon: Schema.optional(Schema.NullOr(Primitive.HttpsUrl)),
  expectedRevision: Schema.Int.annotate({ description: "The revision the edit starts from. Another edit gives 409." }),
}).annotate({
  identifier: "App.UpdateInput",
  description: "The whole definition: it replaces the current one.",
})

export interface TransferOwnershipInput extends Schema.Schema.Type<typeof TransferOwnershipInput> {}
export const TransferOwnershipInput = Schema.Struct({
  spaceId: Space.ID,
}).annotate({ identifier: "App.TransferOwnershipInput" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID),
  connected: Schema.optional(Schema.Boolean).annotate({
    description: "Only apps with a profile you can see, registry apps too. Without it, only the organization’s apps.",
  }),
  ...Pagination.fields(50),
}).annotate({ identifier: "App.ListInput" })

export const definition = Primitive.define({
  name: "app",
  plural: "apps",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Pagination.Page(Info).annotate({ identifier: "App.Page" }) },
  get: true,
  create: { input: CreateInput, result: Info },
  update: { input: UpdateInput, result: Info },
  archive: true,
  actions: { transferOwnership: { input: TransferOwnershipInput, result: Info } },
})

export const maxDepth = 3

export interface DependencyIssue {
  readonly kind: "missing" | "cycle" | "depth"
  readonly path: ReadonlyArray<string>
}

export const dependencyIssues = (
  apps: ReadonlyMap<string, Pick<Declaration, "dependsOn">>,
): ReadonlyArray<DependencyIssue> => {
  const chains = new Map<string, ReadonlyArray<string>>()
  const active = new Map<string, number>()
  const path: Array<string> = []
  const issues: Array<DependencyIssue> = []
  const visit = (slug: string): ReadonlyArray<string> => {
    const chain = chains.get(slug)
    if (chain) return chain
    const start = active.get(slug)
    if (typeof start === "number") {
      issues.push({ kind: "cycle", path: [...path.slice(start), slug] })
      return [slug]
    }
    const app = apps.get(slug)
    if (!app) {
      issues.push({ kind: "missing", path: [...path, slug] })
      return []
    }
    active.set(slug, path.length)
    path.push(slug)
    const longest = app.dependsOn
      .map(visit)
      .reduce<ReadonlyArray<string>>((left, right) => (right.length > left.length ? right : left), [])
    path.pop()
    active.delete(slug)
    chains.set(slug, [slug, ...longest])
    return [slug, ...longest]
  }
  const deepest = [...apps.keys()]
    .map(visit)
    .reduce<ReadonlyArray<string>>((left, right) => (right.length > left.length ? right : left), [])
  const isAcyclic = issues.every((issue) => issue.kind !== "cycle")
  return [...issues, ...(isAcyclic && deepest.length > maxDepth ? [{ kind: "depth" as const, path: deepest }] : [])]
}

export const describeIssue = (issue: DependencyIssue) => {
  const path = issue.path.join(" -> ")
  if (issue.kind === "missing") return `Missing dependency: ${path}.`
  if (issue.kind === "cycle") return `Dependency cycle: ${path}.`
  return `Apps depend ${issue.path.length} levels deep: ${path}. An app's dependencies may have dependencies of their own, but no deeper (${maxDepth} levels).`
}
