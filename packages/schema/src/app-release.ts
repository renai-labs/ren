export * as AppRelease from "./app-release.js"

import { Effect, Schema } from "effect"
import { AppIdentity } from "./app/identity.js"
import { Credential } from "./credential.js"
import { Identifier } from "./identifier.js"
import { Mcp } from "./mcp.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Skill } from "./skill.js"

export const ID = Identifier.make("apr", "AppRelease.ID")
export type ID = typeof ID.Type

const numericVersion = "(?:0|[1-9]\\d*)"
const prereleaseIdentifier = "(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)"
export const Version = Schema.String.check(
  Schema.isPattern(
    new RegExp(
      `^${numericVersion}\\.${numericVersion}\\.${numericVersion}(?:-${prereleaseIdentifier}(?:\\.${prereleaseIdentifier})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
      "u",
    ),
  ),
).annotate({
  identifier: "AppRelease.Version",
})

export const nextVersion = (current: string, bump?: "patch" | "minor" | "major") => {
  const parts = current
    .replace(/[-+].*$/u, "")
    .split(".")
    .map(BigInt)
  const major = parts.at(0) ?? 0n
  const minor = parts.at(1) ?? 0n
  const patch = parts.at(2) ?? 0n
  const isPrerelease = current.replace(/\+.*$/u, "").includes("-")
  if (bump === "major") return `${isPrerelease && minor === 0n && patch === 0n ? major : major + 1n}.0.0`
  if (bump === "minor") return `${major}.${isPrerelease && patch === 0n ? minor : minor + 1n}.0`
  if (isPrerelease) return `${major}.${minor}.${patch}`
  return `${major}.${minor}.${patch + 1n}`
}

const PackageList = Schema.optionalKey(Schema.Array(Schema.NonEmptyString))

export interface Packages extends Schema.Schema.Type<typeof Packages> {}
export const Packages = Schema.Struct({
  apt: PackageList,
  npm: PackageList,
  pip: PackageList,
  go: PackageList,
}).annotate({ identifier: "AppRelease.Packages" })

export interface Environment extends Schema.Schema.Type<typeof Environment> {}
export const Environment = Schema.Struct({
  packages: Packages.pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  buildCommands: Schema.Array(Schema.NonEmptyString.check(Schema.isMaxLength(4096)))
    .check(Schema.isMaxLength(50))
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
}).annotate({ identifier: "AppRelease.Environment" })

export interface Configuration extends Schema.Schema.Type<typeof Configuration> {}
export const Configuration = Schema.Struct({
  requiredCredentials: Schema.Array(Credential.Requirement).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
  environment: Schema.optionalKey(Environment),
  skills: Schema.Record(Primitive.Slug, Skill.Declaration).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  mcps: Schema.Record(Primitive.Slug, Mcp.Declaration).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  dependsOn: Schema.Array(Primitive.Slug).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
}).annotate({ identifier: "AppRelease.Configuration" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  ...Configuration.fields,
  mcps: Schema.Record(Primitive.Slug, Mcp.Info),
  skills: Schema.Record(Primitive.Slug, Skill.Info),
  id: ID,
  appId: AppIdentity.ID,
  version: Version,
  createdAt: Schema.DateTimeUtc,
}).annotate({ identifier: "AppRelease.Info" })

export interface CreateInput extends Schema.Schema.Type<typeof CreateInput> {}
export const CreateInput = Schema.Struct({
  ...Configuration.fields,
  environment: Schema.optional(Environment),
  appId: AppIdentity.ID,
  expectedLatestReleaseId: ID,
  version: Schema.optional(Version),
  bump: Schema.optional(Schema.Literals(["patch", "minor", "major"])),
}).annotate({ identifier: "AppRelease.CreateInput" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({ appId: AppIdentity.ID, ...Pagination.fields(50) }).annotate({
  identifier: "AppRelease.ListInput",
})

export const definition = Primitive.define({
  name: "app-release",
  plural: "app-releases",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Pagination.Page(Info).annotate({ identifier: "AppRelease.Page" }) },
  get: true,
  create: { input: CreateInput, result: Info },
})
