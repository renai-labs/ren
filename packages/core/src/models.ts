export * as Models from "./models.js"

import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import type { Space } from "@ren/schema/space"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import {
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Schedule,
  Redacted,
  Ref,
  Schema,
  Struct,
} from "effect"
import { RenInference } from "./ren-inference.js"

export {
  Access,
  Catalog,
  Endpoint,
  InferenceModelInfo,
  catalog,
  fromInference,
  personLabel,
  placeholderKey,
} from "@ren/schema/models"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Models.Unavailable", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly catalog: (organizationId: Auth.OrganizationID) => Effect.Effect<Models.Catalog, Unavailable>
  readonly revision: Effect.Effect<string>
  readonly grant: (
    brainId: Brain.ID,
    organizationId: Auth.OrganizationID,
    spaceId: Space.ID,
  ) => Effect.Effect<Models.Access, Unavailable>
  readonly inference: Effect.Effect<Option.Option<{ readonly baseUrl: string }>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Models") {}

export const keyLifetime = Duration.hours(6)

export const layerNone = Layer.succeed(
  Service,
  Service.of({
    catalog: Effect.fn("Models.catalog")(function* () {
      return { endpoints: [] }
    }),
    revision: Effect.succeed("none"),
    grant: Effect.fn("Models.grant")(function* () {
      return Models.Access.make({ endpoints: [] })
    }),
    inference: Effect.succeedNone,
  }),
)

const refreshEvery = Duration.seconds(30)

const apiUrl = (root: string) => `${root}/v1`

export const layerInferenceGateway = Layer.effect(
  Service,
  Effect.gen(function* () {
    const root = (yield* Config.String("REN_INFERENCE_GATEWAY_URL")).replace(/\/+$/u, "")
    const brainRoot = (yield* Config.String("REN_INFERENCE_GATEWAY_BRAIN_URL").pipe(Config.withDefault(root))).replace(
      /\/+$/u,
      "",
    )
    const key = yield* Config.Redacted("REN_INFERENCE_GATEWAY_KEY")
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const read = http
      .execute(HttpClientRequest.get(`${root}/model/info`).pipe(HttpClientRequest.bearerToken(Redacted.value(key))))
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Models.InferenceModelInfo)),
        Effect.timeout(Duration.seconds(10)),
        Effect.map(Models.fromInference),
      )
    const current = yield* Ref.make(Option.none<Models.Catalog>())
    const load = read.pipe(
      Effect.tap((catalog) => Ref.set(current, Option.some(catalog))),
      Effect.tapError((error) =>
        Effect.logWarning("The inference gateway's model list could not be read; Ren keeps its last list", error),
      ),
    )
    yield* load.pipe(
      Effect.ignore,
      Effect.repeat(Schedule.spaced(refreshEvery)),
      Effect.withErrorReporting,
      Effect.forkScoped,
    )
    const catalog = Effect.gen(function* () {
      const found = yield* Ref.get(current)
      if (Option.isSome(found)) return found.value
      return yield* load.pipe(Effect.mapError((cause) => new Unavailable({ cause })))
    })
    return Service.of({
      catalog: Effect.fn("Models.catalog")(function* () {
        return yield* catalog
      }),
      revision: Effect.map(Ref.get(current), (found) => Bun.hash(JSON.stringify(Option.getOrNull(found))).toString(16)),
      grant: Effect.fn("Models.grant")(function* () {
        const found = yield* catalog
        const expiresAt = DateTime.addDuration(yield* DateTime.now, keyLifetime)
        return Models.Access.make({
          endpoints: found.endpoints.map((endpoint) =>
            Struct.assign(endpoint, { baseUrl: apiUrl(brainRoot), apiKey: { key, expiresAt } }),
          ),
        })
      }),
      inference: Effect.succeed(Option.some({ baseUrl: brainRoot })),
    })
  }),
)

const encodeCatalog = Schema.encodeSync(Models.Catalog)

export const layerRenInference = Layer.effect(
  Service,
  Effect.gen(function* () {
    const inference = yield* RenInference.Service
    const brainRoot = (yield* Config.String("REN_INFERENCE_BRAIN_URL").pipe(
      Config.orElse(() => Config.String("REN_INFERENCE_URL")),
    )).replace(/\/+$/u, "")
    const revision = yield* Ref.make("ren-inference")
    const remember = (catalog: Models.Catalog) =>
      Ref.set(revision, Bun.hash(JSON.stringify(encodeCatalog(catalog))).toString(16))
    const catalog = Effect.fn("Models.catalog")(function* (organizationId: Auth.OrganizationID) {
      const found = yield* inference
        .catalog(organizationId)
        .pipe(Effect.mapError((cause) => new Unavailable({ cause })))
      yield* remember(found)
      return found
    })
    return Service.of({
      catalog,
      revision: Ref.get(revision),
      grant: Effect.fn("Models.grant")(function* (brainId, organizationId, spaceId) {
        const found = yield* catalog(organizationId)
        const apiKey = yield* inference
          .grant(brainId, organizationId, spaceId)
          .pipe(Effect.mapError((cause) => new Unavailable({ cause })))
        return Models.Access.make({
          endpoints: found.endpoints.map((endpoint) => Struct.assign(endpoint, { baseUrl: apiUrl(brainRoot), apiKey })),
        })
      }),
      inference: Effect.succeed(Option.some({ baseUrl: brainRoot })),
    })
  }),
)
