import { Usage } from "@ren/schema/usage"
import { Context, type Option } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSecurity, OpenApi } from "effect/http-api"
import { InvalidRequestError, UnauthorizedError, UnavailableError } from "./errors.js"

export class UsageProducer extends Context.Service<UsageProducer, { readonly source: Option.Option<string> }>()(
  "@ren/protocol/UsageProducer",
) {}

export class UsageAuthentication extends HttpApiMiddleware.Service<UsageAuthentication, { provides: UsageProducer }>()(
  "@ren/protocol/UsageAuthentication",
  {
    error: UnauthorizedError,
    security: {
      bearer: HttpApiSecurity.bearer.pipe(
        HttpApiSecurity.annotate(
          OpenApi.Description,
          "A usage ingest key. `INTEGRATIONS_INGEST_KEY` writes only rows of source `ren-integrations`.",
        ),
      ),
    },
  },
) {}

const UsageGroup = HttpApiGroup.make("usage")
  .add(
    HttpApiEndpoint.post("usage.record", "/usage/v1/events", {
      payload: Usage.Batch,
      success: Usage.Recorded,
      error: [InvalidRequestError, UnauthorizedError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "usage.record",
        summary: "Record usage events",
        description:
          "Store a batch of 1 to 500 usage events. Ren answers after the insert commits. A repeat of `(source, id)` is ignored, so `inserted` counts only new rows. 400: an event is not valid, and Ren stores no event of the batch; do not send it again. 401: the key may not write an event’s source, and Ren stores no event of the batch. 503: send the same batch again later.",
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
