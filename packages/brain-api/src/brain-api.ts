import { Session } from "@ren/schema/session"
import { Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { BrainRejectedError, ForbiddenError, SessionNotStartedError } from "./errors.js"

const SendBody = Session.SendInput.mapFields(Struct.omit(["sessionId"])).annotate({ identifier: "Brain.SendBody" })

const BrainGroup = HttpApiGroup.make("brain")
  .add(
    HttpApiEndpoint.post("brain.start", "/ren/sessions", {
      payload: Session.StartInput,
      success: Session.Started,
      error: [ForbiddenError, BrainRejectedError],
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
      error: [ForbiddenError, BrainRejectedError, SessionNotStartedError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "brain.send",
        summary: "Send a message",
        description: "Accept a message for a started session, deduplicated by message ID.",
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
