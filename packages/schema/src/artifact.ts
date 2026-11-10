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

export const OperationID = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("Artifact.OperationID"),
  Schema.annotate({
    identifier: "Artifact.OperationID",
    description:
      "Names one publish. A retry with the same id, after the publish succeeded, returns the artifact as it is.",
  }),
)
export type OperationID = typeof OperationID.Type

export const workerPath = "_worker.js"

const maxTotalBytes = 20 * 1024 * 1024

export const Files = Schema.Record(Drive.Path, Schema.Uint8ArrayFromBase64.check(Schema.isMaxLength(5 * 1024 * 1024)))
  .check(
    Schema.isMinProperties(1),
    Schema.isMaxProperties(500),
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

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  title: Primitive.Name,
  url: Schema.String,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Artifact.Info" })

export interface PublishInput extends Schema.Schema.Type<typeof PublishInput> {}
export const PublishInput = Schema.Struct({
  operationId: OperationID,
  title: Primitive.Name,
  entry: Drive.Path.annotate({ description: "The file a person opens first, such as index.html." }),
  files: Files,
})
  .check(
    Schema.makeFilter(
      (input) => Object.hasOwn(input.files, input.entry) || { path: ["entry"], issue: "Name one of the files." },
    ),
  )
  .annotate({ identifier: "Artifact.PublishInput" })
