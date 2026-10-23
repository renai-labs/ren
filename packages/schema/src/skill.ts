export * as Skill from "./skill.js"

import { Effect, Schema } from "effect"
import { Credential } from "./credential.js"
import { Primitive } from "./primitive.js"

export const SourceDirectory = Schema.String.check(
  Schema.makeFilter(
    (path) =>
      path === "." ||
      (path.length > 0 &&
        !path.includes("\\") &&
        !path.includes("\0") &&
        path
          .split("/")
          .every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && !segment.includes(":"))) ||
      "Use . or a safe relative source directory.",
  ),
).annotate({ identifier: "Skill.SourceDirectory" })

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
  requiredCredentials: Schema.Array(Credential.SkillRequirement).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([])),
  ),
  upstream: Schema.Struct({
    url: Primitive.HttpsUrl,
    ref: Schema.optionalKey(
      Schema.NonEmptyString.annotate({
        description:
          "A Git branch, tag or commit. Omission follows the default branch. A branch or the default branch is read again by the brain: its new commits change the skill without a new release or catalog fingerprint. Name a commit to fix the content.",
      }),
    ),
    path: SourceDirectory,
  }),
}).annotate({ identifier: "Skill.Upstream" })

export const Declaration = Schema.Union([Content, Upstream]).annotate({ identifier: "Skill.Declaration" })
export type Declaration = typeof Declaration.Type

export const Info = Schema.Union([
  Content,
  Schema.Struct({
    ...Upstream.fields,
    upstream: Schema.Struct({ ...Upstream.fields.upstream.fields, url: Schema.String, path: Schema.String }),
  }),
]).annotate({ identifier: "Skill.Info" })
export type Info = typeof Info.Type
