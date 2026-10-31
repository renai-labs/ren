import { Usage } from "@ren/schema/usage"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { InvalidRequestError, UnauthorizedError, UnavailableError } from "./errors.js"

export class UsageAuthentication extends HttpApiMiddleware.Service<UsageAuthentication>()(
  "@ren/protocol/UsageAuthentication",
  {
    error: UnauthorizedError,
    security: {
      bearer: HttpApiSecurity.bearer.pipe(HttpApiSecurity.annotate(OpenApi.Description, "The usage ingest key.")),
    },
  },
) {}

const UsageGroup = HttpApiGroup.make("usage")
  .add(
    HttpApiEndpoint.post("usage.record", "/usage/v1/events", {
      payload: Usage.Batch,
      success: Usage.Recorded,
      error: [InvalidRequestError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "usage.record",
        summary: "Record usage events",
        description:
          "Store a batch of 1 to 500 usage events. Ren answers after the insert commits. A repeat of `(source, id)` is ignored, so `inserted` counts only new rows. 400: an event is not valid, and Ren stores no event of the batch; do not send it again. 503: send the same batch again later.",
      }),
    ),
  )
  .middleware(UsageAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "usage" }))

export const UsageIngestApi = HttpApi.make("usage-ingest")
  .add(UsageGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Usage Ingest API",
      version: "1",
      description: "Internal API where a trusted producer, such as the model gateway, sends the costs that it saw.",
    }),
  )
