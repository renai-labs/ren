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

const UpstreamInfo = Schema.Struct({
  ...Upstream.fields,
  upstream: Schema.Struct({ ...Upstream.fields.upstream.fields, url: Schema.String, path: Schema.String }),
})

export const Info = Schema.Union([Content, UpstreamInfo]).annotate({ identifier: "Skill.Info" })
export type Info = typeof Info.Type

const frontmatterFields = ["allowed-tools", "compatibility", "description", "license", "metadata", "name"]

const slug = new RegExp(`^${Primitive.slugPattern}$`, "u")

// oxlint-disable-next-line typescript/no-misused-spread -- skills-ref counts code points, as Python's len does.
const codePoints = (text: string) => [...text].length

const nameIssues = (value: unknown, folder: string | undefined) => {
  if (typeof value !== "string" || !value.trim()) return ["Field 'name' must be a non-empty string"]
  const name = value.trim().normalize("NFKC")
  const issues = [
    {
      failed: codePoints(name) > 64,
      issue: `Skill name '${name}' exceeds 64 character limit (${codePoints(name)} chars)`,
    },
    { failed: name !== name.toLowerCase(), issue: `Skill name '${name}' must be lowercase` },
    { failed: name.startsWith("-") || name.endsWith("-"), issue: "Skill name cannot start or end with a hyphen" },
    { failed: name.includes("--"), issue: "Skill name cannot contain consecutive hyphens" },
    {
      failed: !/^[\p{L}\p{N}-]+$/u.test(name),
      issue: `Skill name '${name}' contains invalid characters. Only letters, digits, and hyphens are allowed.`,
    },
    {
      failed: Boolean(folder) && folder?.normalize("NFKC") !== name,
      issue: `Directory name '${folder ?? ""}' must match skill name '${name}'`,
    },
  ]
    .filter((check) => check.failed)
    .map((check) => check.issue)
  if (issues.length > 0 || slug.test(name)) return issues
  return [`Ren needs skill names in lowercase a-z and 0-9, joined by single hyphens: '${name}'`]
}

const descriptionIssues = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return ["Field 'description' must be a non-empty string"]
  return codePoints(value) > 1024 ? [`Description exceeds 1024 character limit (${codePoints(value)} chars)`] : []
}

const compatibilityIssues = (value: unknown) => {
  if (typeof value !== "string") return ["Field 'compatibility' must be a string"]
  return codePoints(value) > 500 ? [`Compatibility exceeds 500 character limit (${codePoints(value)} chars)`] : []
}

export const validate = (metadata: Readonly<Record<string, unknown>>, folder?: string): ReadonlyArray<string> => {
  const unexpected = Object.keys(metadata)
    .filter((field) => !frontmatterFields.includes(field))
    .toSorted()
  return [
    ...(unexpected.length > 0
      ? [
          `Unexpected fields in frontmatter: ${unexpected.join(", ")}. Only [${frontmatterFields.map((field) => `'${field}'`).join(", ")}] are allowed.`,
        ]
      : []),
    ...(Object.hasOwn(metadata, "name")
      ? nameIssues(metadata.name, folder)
      : ["Missing required field in frontmatter: name"]),
    ...(Object.hasOwn(metadata, "description")
      ? descriptionIssues(metadata.description)
      : ["Missing required field in frontmatter: description"]),
    ...(Object.hasOwn(metadata, "compatibility") ? compatibilityIssues(metadata.compatibility) : []),
  ]
}

export const Summary = Schema.Union([
  Schema.Struct({
    type: Content.fields.type,
    description: Content.fields.description,
    requiredCredentials: Content.fields.requiredCredentials,
  }),
  UpstreamInfo,
]).annotate({
  identifier: "Skill.Summary",
  description: "A skill without its content: a content skill has no instructions or files.",
})
export type Summary = typeof Summary.Type
