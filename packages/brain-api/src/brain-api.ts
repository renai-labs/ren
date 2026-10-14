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
        description:
          "Create the session in its harness, or re-apply the title, agent, model and instructions to a session that exists. The session id must be the token’s.",
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
        description:
          "Send a message to a started session. Answers once the harness accepts it, before the turn ends. A repeated message id runs no second turn.",
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
      description: "What any host of a session serves to the Ren server. Internal, not part of the public API.",
    }),
  )
