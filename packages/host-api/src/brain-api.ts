import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import {
  BrainRejectedError,
  ForbiddenError,
  ModelsNotConfiguredError,
  SessionNotStartedError,
  SyncUnavailableError,
} from "./errors.js"

export const StartBody = Session.StartInput.mapFields((fields) => ({
  ...Struct.omit(fields, ["environmentTemplateId"]),
  directory: Schema.optionalKey(
    Environment.Directory.annotate({
      description: "The session’s directory on its environment. Only a session with an environment has one.",
    }),
  ),
})).annotate({ identifier: "Brain.StartBody" })
export type StartBody = typeof StartBody.Type

const SendBody = Session.SendInput.mapFields(Struct.omit(["sessionId"])).annotate({ identifier: "Brain.SendBody" })

export const Synced = Schema.Struct({ drained: Schema.Boolean }).annotate({ identifier: "Brain.Synced" })
export type Synced = typeof Synced.Type

const BrainGroup = HttpApiGroup.make("brain")
  .add(
    HttpApiEndpoint.post("brain.start", "/ren/sessions", {
      payload: StartBody,
      success: Session.Started,
      error: [ForbiddenError, BrainRejectedError, ModelsNotConfiguredError, SyncUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "brain.start",
        summary: "Start a session",
        description: "Create or reconfigure a session, optionally submitting an initial message.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("brain.send", "/ren/sessions/:id/messages", {
      params: { id: Session.ID },
      payload: SendBody,
      success: Session.Accepted,
      error: [ForbiddenError, BrainRejectedError, SessionNotStartedError, ModelsNotConfiguredError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "brain.send",
        summary: "Send a message",
        description: "Accept a message for a started session, deduplicated by message ID.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("brain.configureModels", "/ren/models", {
      payload: Brain.ModelGrant,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "brain.configureModels",
        summary: "Configure models",
        description:
          "Store the brain’s model endpoints and apply them and their API keys to the open harness. The host token lets the host refresh expiring keys.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("brain.removeModels", "/ren/models").annotateMerge(
      OpenApi.annotations({
        identifier: "brain.removeModels",
        summary: "Remove models",
        description:
          "Delete the brain’s model configuration and its credentials. Start and send fail until a configuration is stored again.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("brain.sync", "/ren/sync", { success: Synced }).annotateMerge(
      OpenApi.annotations({
        identifier: "brain.sync",
        summary: "Sync the host's sessions",
        description:
          "Upload each session that changed to Ren until none needs a pass or a deadline occurs. `drained` is false when a session still needs a pass, or when the host has no Ren URL.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("brain.state", "/ren/state", { success: Session.HostState }).annotateMerge(
      OpenApi.annotations({
        identifier: "brain.state",
        summary: "Read the host's state",
        description: "Read host activity without opening the harness.",
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: "brain" }))

export const BrainApi = HttpApi.make("brain")
  .add(BrainGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Brain API",
      version: "0.0.0",
      description: "Internal API between Ren and session hosts.",
    }),
  )
