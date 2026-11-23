import { ProviderCard } from "@ren/schema/provider-card"
import { Usage } from "@ren/schema/usage"
import { Context, type Option } from "effect"
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  HttpApiSecurity,
  OpenApi,
} from "effect/http-api"
import { ForbiddenError, InvalidRequestError, UnauthorizedError, UnavailableError } from "./errors.js"

export class UsageKey extends Context.Service<UsageKey, { readonly onlySource: Option.Option<string> }>()(
  "@ren/protocol/UsageKey",
) {}

export class UsageAuthentication extends HttpApiMiddleware.Service<UsageAuthentication, { provides: UsageKey }>()(
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
      error: [InvalidRequestError, ForbiddenError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "usage.record",
        summary: "Record usage events",
        description:
          "Store a batch of 1 to 500 usage events. Ren answers after the insert commits. A repeat of `(source, id)` is ignored, so `inserted` counts only new rows. 400: an event is not valid, and Ren stores no event of the batch; do not send it again. 403: the key may not write an event’s source, and Ren stores no event of the batch. 503: send the same batch again later.",
      }),
    ),
  )
  .middleware(UsageAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "usage" }))

const InferenceGroup = HttpApiGroup.make("inference")
  .add(
    HttpApiEndpoint.post("inference.changed", "/internal/inference/changed", {
      payload: ProviderCard.Changed,
      success: HttpApiSchema.NoContent,
      error: [ForbiddenError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "inference.changed",
        summary: "A seat changed",
        description:
          "The model gateway says that an organization’s seat, or the models it lists, changed. Ren reads the organization’s seats and updates its model list. Only the usage ingest key.",
      }),
    ),
  )
  .middleware(UsageAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "inference" }))

export const UsageIngestApi = HttpApi.make("usage-ingest")
  .add(UsageGroup)
  .add(InferenceGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Usage Ingest API",
      version: "1",
      description: "Internal API where a trusted producer, such as the model gateway, sends the costs that it saw.",
    }),
  )
