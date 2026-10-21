export * as Skill from "./skill.js"

import { Effect, Schema } from "effect"
import { Credential } from "./credential.js"
import { Primitive } from "./primitive.js"

export interface Content extends Schema.Schema.Type<typeof Content> {}
export const Content = Schema.Struct({
  type: Schema.Literal("content"),
  description: Schema.NonEmptyString,
  requiredCredentials: Schema.Array(Credential.SkillRequirement).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
  instructions: Schema.String.annotate({ description: "The body of SKILL.md, after its frontmatter." }),
  files: Schema.Record(Schema.String, Schema.String)
    .annotate({ description: "The other files of the skill folder, by path relative to it." })
    .pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed({}))),
}).annotate({ identifier: "Skill.Content" })

export interface Upstream extends Schema.Schema.Type<typeof Upstream> {}
export const Upstream = Schema.Struct({
  type: Schema.Literal("upstream"),
  upstream: Schema.Struct({
    url: Primitive.HttpsUrl,
    ref: Schema.optionalKey(Schema.NonEmptyString.annotate({ description: "A git commit or tag." })),
    path: Schema.optionalKey(Schema.NonEmptyString),
  }),
}).annotate({ identifier: "Skill.Upstream" })

export const Declaration = Schema.Union([Content, Upstream]).annotate({ identifier: "Skill.Declaration" })
export type Declaration = typeof Declaration.Type
