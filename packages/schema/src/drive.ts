export * as Drive from "./drive.js"

import { Option, Schema, SchemaTransformation } from "effect"
import { Mime } from "effect/http"
import { Space } from "./space.js"

const encoder = new TextEncoder()

const bytesOf = (text: string) => encoder.encode(text).length

const maxPathBytes = 768

const maxNameBytes = 255

// oxlint-disable-next-line ren/no-comments -- The largest file in a drive, from an upload or from a chat's output; a deployment can set a lower one (DRIVE_MAX_FILE_SIZE).
export const maxFileBytes = 100 * 1024 * 1024

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

export interface File extends Schema.Schema.Type<typeof File> {}
export const File = Schema.Struct({
  path: Schema.String.annotate({ description: "The file’s path inside its drive." }),
  size: Schema.Int,
  modifiedAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Drive.File" })

export const Disposition = Schema.Literals(["attachment", "inline"]).annotate({
  identifier: "Drive.Disposition",
  description: "`attachment`: the browser saves the file. `inline`: the browser shows it, such as a PDF in a frame.",
})
export type Disposition = typeof Disposition.Type

export interface DownloadInput extends Schema.Schema.Type<typeof DownloadInput> {}
export const DownloadInput = Schema.Struct({
  ...scope,
  path: Path,
  disposition: Schema.optional(Disposition.annotate({ description: "Defaults to `attachment`." })),
}).annotate({ identifier: "Drive.DownloadInput" })

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

export const Access = Schema.Literals(["read", "write"]).annotate({ identifier: "Drive.Access" })
export type Access = typeof Access.Type

export interface Mount extends Schema.Schema.Type<typeof Mount> {}
export const Mount = Schema.Struct({
  kind: Kind,
  alias: Schema.NonEmptyString.annotate({
    description: "`drive:space` or `drive:org`. A user-written reference alias has no `:`.",
  }),
  description: Schema.NonEmptyString.annotate({
    description: "What the drive is. The agent sees a reference only through it (R24).",
  }),
  remote: Remote,
  access: Access,
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

export const chatsFolder = "chats/"

export const uploadsOf = (sessionId: string, messageId: string) => `${chatsFolder}${sessionId}/uploads/${messageId}`

export const outputsOf = (sessionId: string) => `${chatsFolder}${sessionId}/outputs`

export const typeOf = (name: string) =>
  /\.[cm]?ts$/iu.test(name) ? "text/typescript" : Option.getOrElse(Mime.getType(name), () => "application/octet-stream")
