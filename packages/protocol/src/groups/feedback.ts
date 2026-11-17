import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { UnavailableError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

const Report = Schema.Struct({
  message: Schema.Trim.check(
    Schema.isNonEmpty({ message: "Write the feedback." }),
    Schema.isMaxLength(3000, { message: "Use 3000 characters or fewer." }),
  ).annotate({
    description:
      "The feedback in plain words: what happened, what was expected, and what would help. Leave out secrets and personal data the Ren team does not need.",
  }),
})

export const FeedbackGroup = HttpApiGroup.make("feedback")
  .add(
    HttpApiEndpoint.post("feedback.report", "/feedback", {
      payload: Report,
      success: HttpApiSchema.NoContent,
      error: UnavailableError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "feedback.report",
        summary: "Send feedback to the Ren team",
        description:
          "Send feedback about Ren to the Ren team: a bug, something confusing, a missing feature or something that works well. Send it when the person asks you to, or when Ren itself gets in the way of their task and the team should know. The team sees who sent it, from which organization, and, from a chat, the space, agent and chat. Nobody replies here.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "feedback" }))
