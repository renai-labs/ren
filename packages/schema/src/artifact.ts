export * as Artifact from "./artifact.js"

import { Schema } from "effect"
import { Drive } from "./drive.js"
import { Identifier } from "./identifier.js"
import { Pagination } from "./pagination.js"
import { Primitive } from "./primitive.js"
import { Session } from "./session.js"
import { Space } from "./space.js"

export const ID = Identifier.make("art", "Artifact.ID")
  .check(Schema.isPattern(/^art_[0-9A-Za-z]{1,59}$/u))
  .annotate({
    identifier: "Artifact.ID",
    description: "The harness names a new artifact, and Ren keeps that id. It is unique across Ren.",
  })
export type ID = typeof ID.Type

// oxlint-disable-next-line ren/no-comments -- The artifact's host name label and its script name on Cloudflare. A host name has no capitals or `_`; at most 59 characters after `art_` keep it within 63.
export const label = (id: ID) => `art-${Identifier.suffix(id).toLowerCase()}`

// oxlint-disable-next-line ren/no-comments -- Names that would look like a page of Ren or of the platform.
export const reservedNames: ReadonlySet<string> = new Set([
  "www",
  "api",
  "app",
  "admin",
  "auth",
  "login",
  "signin",
  "signup",
  "account",
  "billing",
  "mail",
  "email",
  "support",
  "help",
  "status",
  "docs",
  "blog",
  "static",
  "assets",
  "cdn",
  "ren",
  "useren",
])

export const Name = Schema.String.check(
  Schema.isPattern(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u, {
    message: "Use 1 to 63 lowercase letters, digits and hyphens, with no hyphen at the start or the end.",
  }),
  Schema.makeFilter((name) => !name.startsWith("art-") || "A name cannot start with art-."),
  Schema.makeFilter((name) => !reservedNames.has(name) || `${name} is reserved.`),
).annotate({
  identifier: "Artifact.Name",
  description: "The artifact’s own host name: https://<name>.<artifact domain>/. Unique across Ren.",
})
export type Name = typeof Name.Type

// oxlint-disable-next-line ren/no-comments -- The name an artifact gets from its title when nobody picks one: none when the title has no letter or digit, or when the result is not a valid name.
export const nameOf = (title: string) => {
  const base = title
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .slice(0, 40)
    .replaceAll(/^-+|-+$/gu, "")
  return Schema.is(Name)(base) ? base : undefined
}

export const ProviderID = Schema.NonEmptyString.pipe(
  Schema.brand("Artifact.ProviderID"),
  Schema.annotate({ identifier: "Artifact.ProviderID" }),
)
export type ProviderID = typeof ProviderID.Type

export const DeploymentID = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("Artifact.DeploymentID"),
  Schema.annotate({
    identifier: "Artifact.DeploymentID",
    description:
      "Names one deployment or stop. Retrying a deployment with it returns that deployment without starting another.",
  }),
)
export type DeploymentID = typeof DeploymentID.Type

export const workerPath = "_worker.js"

export const manifestPath = "ren-artifact.json"

export const maxFileBytes = 25 * 1024 * 1024

export const maxTotalBytes = 200 * 1024 * 1024

export const maxFiles = 2000

export const Files = Schema.Record(Drive.Path, Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(maxFileBytes)))
  .check(
    Schema.isMinProperties(1),
    Schema.isMaxProperties(maxFiles),
    Schema.makeFilter(
      (files) =>
        Object.values(files).reduce((total, bytes) => total + bytes.byteLength, 0) <= maxTotalBytes ||
        `Keep all files at ${maxTotalBytes} bytes or fewer.`,
    ),
  )
  .annotate({
    identifier: "Artifact.Files",
    description: `Every file of the artifact, by path. ${workerPath} is an ES module Worker; every other file is served as it is.`,
  })
export type Files = typeof Files.Type

export const Status = Schema.Literals(["deploying", "stopping", "ready", "failed", "stopped"]).annotate({
  identifier: "Artifact.Status",
})
export type Status = typeof Status.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  title: Primitive.Name,
  name: Schema.NullOr(Schema.String).annotate({ description: "The artifact’s own host name. Null when it has none." }),
  entry: Schema.NullOr(Schema.String).annotate({
    description: "The file a person opens first, such as index.html. Null until the first deployment is ready.",
  }),
  url: Schema.NullOr(Schema.String).annotate({
    description: "The link anyone can open without signing in. Null while the artifact is not served.",
  }),
  pendingDeploymentId: Schema.NullOr(DeploymentID).annotate({
    description: "The deployment or stop in progress. Null when none is.",
  }),
  publishedDeploymentId: Schema.NullOr(DeploymentID).annotate({
    description: "The last deployment that became ready. A stop does not change it.",
  }),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  archivedAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Artifact.Info" })

export interface ListInput extends Schema.Schema.Type<typeof ListInput> {}
export const ListInput = Schema.Struct({
  spaceId: Schema.optional(Space.ID).annotate({ description: "Without it, the artifacts of every space you are in." }),
  ...Pagination.fields(50),
}).annotate({ identifier: "Artifact.ListInput" })

const Page = Pagination.Page(Info).annotate({ identifier: "Artifact.Page" })

export interface UpdateInput extends Schema.Schema.Type<typeof UpdateInput> {}
export const UpdateInput = Schema.Struct({
  title: Schema.optional(Primitive.Name).annotate({
    description: "The new title. Omit to keep it. A later deployment that names a title replaces it.",
  }),
  name: Schema.optional(Schema.NullOr(Name)).annotate({
    description: "The new name. Omit to keep it; null removes it. The old name is free at once.",
  }),
}).annotate({ identifier: "Artifact.UpdateInput" })

export const definition = Primitive.define({
  name: "artifact",
  plural: "artifacts",
  id: ID,
  info: Info,
  list: { input: ListInput, page: Page },
  get: true,
  update: { input: UpdateInput, result: Info },
  archive: true,
})

export const DurableObjects = Schema.Record(
  Schema.String,
  Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u)),
)
  .check(
    Schema.makeFilter(
      (bindings) =>
        Object.keys(bindings).every((name) => /^(?!ASSETS$)[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) ||
        "Use JavaScript binding identifiers other than ASSETS.",
    ),
  )
  .annotate({
    identifier: "Artifact.DurableObjects",
    description: "Binding names mapped to exported SQLite Durable Object class names. Keep names stable.",
  })

export interface Config extends Schema.Schema.Type<typeof Config> {}
export const Config = Schema.Struct({
  entry: Drive.Path.annotate({ description: "The file a person opens first, such as index.html." }),
  durableObjects: Schema.optional(DurableObjects),
}).annotate({ identifier: "Artifact.Config" })

export interface Deployment extends Schema.Schema.Type<typeof Deployment> {}
export const Deployment = Schema.Struct({
  artifactId: ID,
  deploymentId: DeploymentID,
  status: Status,
  url: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
}).annotate({ identifier: "Artifact.Deployment" })

export const UploadID = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("Artifact.UploadID"),
  Schema.annotate({ identifier: "Artifact.UploadID" }),
)
export type UploadID = typeof UploadID.Type

export interface Upload extends Schema.Schema.Type<typeof Upload> {}
export const Upload = Schema.Struct({
  uploadId: UploadID,
  url: Schema.String.annotate({
    description: `PUT the source archive here: a .tar.gz with every file under one top-level folder, at most ${maxFiles} files of ${maxFileBytes} bytes each and ${maxTotalBytes} bytes in all.`,
  }),
  expiresAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Artifact.Upload" })

export interface Archive extends Schema.Schema.Type<typeof Archive> {}
export const Archive = Schema.Struct({
  url: Schema.String.annotate({
    description: "GET the last published source archive here, in the same form as an upload.",
  }),
  expiresAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Artifact.Archive" })

export interface DeployInput extends Schema.Schema.Type<typeof DeployInput> {}
export const DeployInput = Schema.Struct({
  deploymentId: DeploymentID,
  baseDeploymentId: Schema.optional(DeploymentID).annotate({
    description:
      "The deployment your change starts from: the deploymentId of the last read, create or update. Ren refuses a deployment whose base is not the published one, so a change never overwrites one it did not see. A failed deployment counts as its own base. A new artifact, or one that was never ready, needs none.",
  }),
  uploadId: UploadID.annotate({
    description: `The upload that holds the source archive. Ren checks it on deploy and reads the Durable Objects from its ${manifestPath}.`,
  }),
  title: Schema.optional(Primitive.Name).annotate({
    description: "Omit to keep the artifact’s title. A new artifact needs one.",
  }),
  name: Schema.optional(Name).annotate({
    description:
      "The artifact’s own host name. Omit to keep the current name. A new artifact without one gets a name from its title.",
  }),
  entry: Schema.optional(Drive.Path).annotate({
    description:
      "The file a person opens first. Omit to keep the current entry while it is one of the files, or to use index.html, index.md or the only file.",
  }),
  sessionId: Schema.optional(Session.ID).annotate({
    description: "The chat that asks. Ren sends the result there when the deployment ends.",
  }),
}).annotate({ identifier: "Artifact.DeployInput" })

export interface StopInput extends Schema.Schema.Type<typeof StopInput> {}
export const StopInput = Schema.Struct({
  sessionId: Schema.optional(Session.ID).annotate({
    description: "The chat that asks. Ren sends the result there when the stop ends.",
  }),
}).annotate({ identifier: "Artifact.StopInput" })
