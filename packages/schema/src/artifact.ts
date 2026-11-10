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

export const Status = Schema.Literals(["deploying", "ready", "failed", "stopped"]).annotate({
  identifier: "Artifact.Status",
})
export type Status = typeof Status.Type

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  id: ID,
  spaceId: Space.ID,
  title: Primitive.Name,
  url: Schema.NullOr(Schema.String),
  activeDeploymentId: Schema.NullOr(DeploymentID),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).annotate({ identifier: "Artifact.Info" })

export interface Config extends Schema.Schema.Type<typeof Config> {}
export const Config = Schema.Struct({
  entry: Drive.Path.annotate({ description: "The file a person opens first, such as index.html." }),
}).annotate({ identifier: "Artifact.Config" })

export interface Deployment extends Schema.Schema.Type<typeof Deployment> {}
export const Deployment = Schema.Struct({
  artifactId: ID,
  deploymentId: DeploymentID,
  status: Status,
  url: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
}).annotate({ identifier: "Artifact.Deployment" })

export interface DeployInput extends Schema.Schema.Type<typeof DeployInput> {}
export const DeployInput = Schema.Struct({
  deploymentId: DeploymentID,
  title: Primitive.Name,
  config: Config,
  files: Files,
})
  .check(
    Schema.makeFilter(
      (input) =>
        Object.hasOwn(input.files, input.config.entry) || {
          path: ["config", "entry"],
          issue: "Name one of the files.",
        },
    ),
  )
  .annotate({ identifier: "Artifact.DeployInput" })
