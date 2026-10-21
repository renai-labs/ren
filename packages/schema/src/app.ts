export * as App from "./app.js"

import { Effect, Schema } from "effect"
import { Credential } from "./credential.js"
import { Mcp } from "./mcp.js"
import { Primitive } from "./primitive.js"
import { Skill } from "./skill.js"

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

export interface Declaration extends Schema.Schema.Type<typeof Declaration> {}
export const Declaration = Schema.Struct({
  name: Primitive.Name,
  description: Schema.NonEmptyString,
  icon: Schema.optionalKey(Primitive.HttpsUrl),
  dependsOn: Schema.Array(Primitive.Slug).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
  requiredCredentials: Schema.Array(Credential.Requirement).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed([]))),
  environment: Schema.optionalKey(Environment),
  skills: Schema.Record(Primitive.Slug, Skill.Declaration).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
  mcps: Schema.Record(Primitive.Slug, Mcp.Declaration).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
}).annotate({ identifier: "App.Declaration" })
