export * as Artifact from "./artifact.js"

import { Schema } from "effect"
import { Drive } from "./drive.js"
import { Identifier } from "./identifier.js"
import { Primitive } from "./primitive.js"
import { Space } from "./space.js"

export const ID = Identifier.make("art", "Artifact.ID")
  .check(Schema.isPattern(/^art_[0-9A-Za-z]{1,64}$/u))
  .annotate({
    identifier: "Artifact.ID",
    description: "The harness names a new artifact, and Ren keeps that id. It is unique across Ren.",
  })
export type ID = typeof ID.Type

export const ProviderID = Schema.NonEmptyString.pipe(
  Schema.brand("Artifact.ProviderID"),
  Schema.annotate({ identifier: "Artifact.ProviderID" }),
)
export type ProviderID = typeof ProviderID.Type

export const DeploymentID = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("Artifact.DeploymentID"),
  Schema.annotate({
    identifier: "Artifact.DeploymentID",
    description: "Names one deployment. Retrying it returns its workflow result without starting another deployment.",
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

export const Status = Schema.Literals(["deploying", "ready", "failed", "stopped"]).annotate({
  identifier: "Artifact.Status",
})
export type Status = typeof Status.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  title: Primitive.Name,
  entry: Drive.Path.annotate({ description: "The file a person opens first, such as index.html." }),
  url: Schema.NullOr(Schema.String),
  activeDeploymentId: Schema.NullOr(DeploymentID),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Artifact.Info" })

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
  uploadId: UploadID.annotate({
    description: `The upload that holds the source archive. Ren checks it on deploy and reads the Durable Objects from its ${manifestPath}.`,
  }),
  title: Schema.optional(Primitive.Name).annotate({
    description: "Omit to keep the artifact’s title. A new artifact needs one.",
  }),
  entry: Schema.optional(Drive.Path).annotate({
    description:
      "The file a person opens first. Omit to keep the current entry while it is one of the files, or to use index.html, index.md or the only file.",
  }),
}).annotate({ identifier: "Artifact.DeployInput" })
