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

export const hostTokenHeader = "ren-host-token"

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

export const SetModelBody = Schema.Struct({ model: Schema.NullOr(Session.Model) }).annotate({
  identifier: "Brain.SetModelBody",
})

export interface State extends Schema.Schema.Type<typeof State> {}
export const State = Schema.Struct({
  brain: Brain.ID,
  generation: Schema.Int,
  version: Schema.String,
  isOpen: Schema.Boolean,
  holders: Schema.Int,
  waitingSince: Schema.NullOr(Schema.DateTimeUtc),
  nextReconcileAt: Schema.NullOr(Schema.DateTimeUtc),
}).annotate({ identifier: "Brain.State" })

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
    HttpApiEndpoint.put("brain.setModel", "/ren/sessions/:id/model", {
      params: { id: Session.ID },
      payload: SetModelBody,
      error: [ForbiddenError, BrainRejectedError, SessionNotStartedError, ModelsNotConfiguredError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "brain.setModel",
        summary: "Set a session’s model",
        description:
          "Set the model of a started session, or clear it with null to use the model its settings give. The model must be in the brain’s model list.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("brain.wake", "/ren/wake").annotateMerge(
      OpenApi.annotations({
        identifier: "brain.wake",
        summary: "Wake the brain",
        description:
          "Ren calls this first after it resumes a paused brain. The brain drops its cached model keys, pulls and syncs, then answers, also when the pull or the sync failed.",
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
    HttpApiEndpoint.get("brain.state", "/ren/state", { success: State }).annotateMerge(
      OpenApi.annotations({
        identifier: "brain.state",
        summary: "Read the host's state",
        description: "Read the brain’s identity, version and activity without opening the harness.",
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
