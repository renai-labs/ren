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

export const ID = AppIdentity.ID
export type ID = typeof ID.Type

const PackageList = Schema.optionalKey(Schema.Array(Schema.NonEmptyString))

export interface Packages extends Schema.Schema.Type<typeof Packages> {}
export const Packages = Schema.Struct({
  apt: PackageList,
  npm: PackageList,
  pip: PackageList,
  go: PackageList,
}).annotate({ identifier: "App.Packages" })

export interface Environment extends Schema.Schema.Type<typeof Environment> {}
export const Environment = Schema.Struct({
  packages: Packages.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  buildCommands: Schema.Array(Schema.NonEmptyString.check(Schema.isMaxLength(4096)))
    .check(Schema.isMaxLength(50))
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
export const ListInput = Schema.Struct({ spaceId: Schema.optional(Space.ID), ...Pagination.fields(50) }).annotate({
  identifier: "App.ListInput",
})

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

export interface DependencyIssue {
  readonly kind: "missing" | "cycle"
  readonly path: ReadonlyArray<string>
}

export const dependencyIssues = (
  apps: ReadonlyMap<string, Pick<Declaration, "dependsOn">>,
): ReadonlyArray<DependencyIssue> => {
  const complete = new Set<string>()
  const active = new Map<string, number>()
  const path: Array<string> = []
  const issues: Array<DependencyIssue> = []
  const visit = (slug: string): void => {
    if (complete.has(slug)) return
    const start = active.get(slug)
    if (typeof start === "number") {
      issues.push({ kind: "cycle", path: [...path.slice(start), slug] })
      return
    }
    const app = apps.get(slug)
    if (!app) {
      issues.push({ kind: "missing", path: [...path, slug] })
      return
    }
    active.set(slug, path.length)
    path.push(slug)
    for (const dependency of app.dependsOn) visit(dependency)
    path.pop()
    active.delete(slug)
    complete.add(slug)
  }
  for (const slug of apps.keys()) visit(slug)
  return issues
}

export const dependencyCycles = (apps: ReadonlyMap<string, Pick<Declaration, "dependsOn">>): ReadonlyArray<string> =>
  dependencyIssues(apps)
    .filter((issue) => issue.kind === "cycle")
    .map((issue) => issue.path.join(" -> "))
