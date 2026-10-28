import { Usage } from "@ren/schema/usage"
import { Context } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { ForbiddenError, InvalidRequestError, UnauthorizedError, UnavailableError } from "./errors.js"

export class CurrentProducer extends Context.Service<CurrentProducer, string>()("@ren/protocol/CurrentProducer") {}

export class UsageAuthentication extends HttpApiMiddleware.Service<
  UsageAuthentication,
  { provides: CurrentProducer }
>()("@ren/protocol/UsageAuthentication", {
  error: UnauthorizedError,
  security: {
    bearer: HttpApiSecurity.bearer.pipe(
      HttpApiSecurity.annotate(OpenApi.Description, "A usage key. It names the producer that may send events."),
    ),
  },
}) {}

const UsageGroup = HttpApiGroup.make("usage")
  .add(
    HttpApiEndpoint.post("usage.record", "/usage/v1/events", {
      payload: Usage.Batch,
      success: Usage.Recorded,
      error: [InvalidRequestError, ForbiddenError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "usage.record",
        summary: "Record usage events",
        description:
          "Store a batch of 1 to 500 usage events. Ren answers after the insert commits. A repeat of `(source, id)` is ignored, so `inserted` counts only new rows. 400: an event is not valid, and Ren stores no event of the batch; do not send it again. 403: an event’s `source` is not the producer of the key. 503: send the same batch again later.",
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
