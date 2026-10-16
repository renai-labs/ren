import { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { BrainRejectedError, ForbiddenError, ModelsNotConfiguredError, SessionNotStartedError } from "./errors.js"

export const ModelsBody = Schema.Struct({
  access: Models.Access,
  hostToken: Schema.optionalKey(Schema.NonEmptyString),
}).annotate({ identifier: "Brain.ModelsBody" })
export type ModelsBody = typeof ModelsBody.Type

const SendBody = Session.SendInput.mapFields(Struct.omit(["sessionId"])).annotate({ identifier: "Brain.SendBody" })

const BrainGroup = HttpApiGroup.make("brain")
  .add(
    HttpApiEndpoint.post("brain.start", "/ren/sessions", {
      payload: Session.StartInput,
      success: Session.Started,
      error: [ForbiddenError, BrainRejectedError, ModelsNotConfiguredError],
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
      payload: ModelsBody,
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
