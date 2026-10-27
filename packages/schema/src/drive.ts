export * as Drive from "./drive.js"

import { Schema, SchemaTransformation } from "effect"
import { Space } from "./space.js"

const encoder = new TextEncoder()

const bytesOf = (text: string) => encoder.encode(text).length

const maxPathBytes = 768

const maxNameBytes = 255

export const Path = Schema.String.check(Schema.isNonEmpty({ message: "Path is required." }))
  .pipe(
    Schema.decode(SchemaTransformation.transform({ decode: (path) => path.normalize("NFC"), encode: (path) => path })),
  )
  .check(
    Schema.makeFilter(
      (path) =>
        path.split("/").every((name) => name !== "" && name !== "." && name !== "..") ||
        "Use a path inside the drive, such as reports/q3.pdf, with no empty, . or .. part.",
    ),
    Schema.makeFilter((path) => !/\p{Cc}/u.test(path) || "A path has no control characters."),
    Schema.makeFilter((path) => !path.includes("${filename}") || "A path has no ${filename}."),
    Schema.makeFilter(
      (path) => path.split("/").every((name) => bytesOf(name) <= maxNameBytes) || "Use names of 255 bytes or fewer.",
    ),
    Schema.makeFilter((path) => bytesOf(path) <= maxPathBytes || `Use a path of ${maxPathBytes} bytes or fewer.`),
  )
  .annotate({
    identifier: "Drive.Path",
    description: "A file’s path inside its drive, such as `reports/q3.pdf`.",
  })

export const Kind = Schema.Literals(["space", "org"]).annotate({
  identifier: "Drive.Kind",
  description:
    "`space`: the drive of one space, which every chat of the space gets. `org`: the drive of the organization, which every chat of the organization gets.",
})
export type Kind = typeof Kind.Type

const scope = {
  spaceId: Schema.optional(
    Space.ID.annotate({ description: "The space whose drive to use. Omit it for the organization’s drive." }),
  ),
}

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  ...scope,
  folder: Schema.optional(
    Path.annotate({ description: "The folder to list, such as `reports`. Omit it for the root." }),
  ),
  cursor: Schema.optional(
    Schema.String.annotate({ description: "The `cursor` of the previous page, to list the next one." }),
  ),
}).annotate({ identifier: "Drive.ListInput" })

export interface File extends Schema.Schema.Type<typeof File> {}
export const File = Schema.Struct({
  path: Schema.String.annotate({ description: "The file’s path inside its drive." }),
  size: Schema.Int,
  modifiedAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Drive.File" })

export interface Listing extends Schema.Schema.Type<typeof Listing> {}
export const Listing = Schema.Struct({
  folders: Schema.Array(Schema.String).annotate({ description: "The paths of the folders directly in the folder." }),
  files: Schema.Array(File).annotate({ description: "The files directly in the folder." }),
  cursor: Schema.NullOr(Schema.String).annotate({ description: "Null on the last page." }),
}).annotate({ identifier: "Drive.Listing", description: "One page of a folder, sorted by path." })

export interface PathInput extends Schema.Schema.Type<typeof PathInput> {}
export const PathInput = Schema.Struct({ ...scope, path: Path }).annotate({ identifier: "Drive.PathInput" })

export interface StartUploadInput extends Schema.Schema.Type<typeof StartUploadInput> {}
export const StartUploadInput = Schema.Struct({
  ...scope,
  path: Path.annotate({ description: "Where the file goes. A file already at the path is replaced." }),
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: "The file’s size in bytes. The upload must send exactly this many.",
  }),
}).annotate({ identifier: "Drive.StartUploadInput" })

export interface Link extends Schema.Schema.Type<typeof Link> {}
export const Link = Schema.Struct({
  url: Schema.String.annotate({ description: "A link that downloads the file, with no other credential." }),
  expiresAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Drive.Link" })

export interface Remote extends Schema.Schema.Type<typeof Remote> {}
export const Remote = Schema.Struct({
  type: Schema.Literal("s3"),
  bucket: Schema.NonEmptyString,
  prefix: Schema.NonEmptyString.annotate({
    description: "The drive’s key prefix, ending with `/`, such as `<orgId>/drives/spaces/<spaceId>/`.",
  }),
  region: Schema.NonEmptyString,
  endpoint: Schema.optionalKey(
    Schema.String.annotate({
      description: "An S3-compatible endpoint, reached path-style, such as RustFS in dev. Omitted for AWS S3.",
    }),
  ),
  placeholder: Schema.NonEmptyString.annotate({
    description:
      "The `ren:<LABEL>` placeholder that rclone sends as its access key and secret. The egress signs each request with real keys.",
  }),
}).annotate({ identifier: "Drive.Remote", description: "Where a drive’s files are, and how rclone reaches them." })

export interface Mount extends Schema.Schema.Type<typeof Mount> {}
export const Mount = Schema.Struct({
  kind: Kind,
  alias: Schema.NonEmptyString.annotate({
    description: "`drive:space` or `drive:org`. A user-written reference alias has no `:`.",
  }),
  description: Schema.NonEmptyString.annotate({
    description: "What the drive is, and that it is read-only. The agent sees a reference only through it (R24).",
  }),
  remote: Remote,
  access: Schema.Literals(["read", "write"]).annotate({
    description: "`read`: the environment mounts the drive read-only. `write`: it may change the drive’s files.",
  }),
}).annotate({ identifier: "Drive.Mount", description: "A drive that a chat’s environment mounts." })

export const UnavailableReason = Schema.Literals(["no_mount", "no_egress"]).annotate({
  identifier: "Drive.UnavailableReason",
  description:
    "`no_mount`: the chat’s environment cannot mount a drive. `no_egress`: the environment is not behind the egress, so a drive cannot get its keys.",
})
export type UnavailableReason = typeof UnavailableReason.Type

export const Availability = Schema.Union([
  Schema.Struct({ type: Schema.Literal("mounts"), mounts: Schema.Array(Mount) }),
  Schema.Struct({ type: Schema.Literal("unavailable"), reason: UnavailableReason }),
]).annotate({
  identifier: "Drive.Availability",
  description:
    "The drives of one chat, which Ren decides from its environment: the mounts, or why the chat gets none. The brain notes the reason to the agent.",
})
export type Availability = typeof Availability.Type
