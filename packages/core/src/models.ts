export * as Models from "./models.js"

import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import {
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schedule,
  Redacted,
  Ref,
  Schema,
  Stream,
  Struct,
} from "effect"

export { Access, Catalog, Endpoint, LiteLLMModelInfo, catalog, fromLiteLLM, placeholderKey } from "@ren/schema/models"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Models.Unavailable", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly catalog: (organizationId: Auth.OrganizationID) => Effect.Effect<Models.Catalog, Unavailable>
  // oxlint-disable-next-line ren/no-comments -- Changes when the model list or a key in it changes, so a cache of grants knows to ask again (H4).
  readonly revision: Effect.Effect<string>
  readonly grant: (brainId: Brain.ID, organizationId: Auth.OrganizationID) => Effect.Effect<Models.Access, Unavailable>
  // oxlint-disable-next-line ren/no-comments -- HR16: the root URL where a brain reads the model list (LiteLLM's /model/info). None: brains get no models.
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

const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(Models.Access))

export const layerConfig = Layer.effect(
  Service,
  Effect.gen(function* () {
    const file = yield* Config.String("REN_MODELS_FILE")
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const read = fs
      .readFileString(file)
      .pipe(
        Effect.flatMap((text) =>
          Effect.map(decodeFile(text), (access) => ({ access, revision: Bun.hash(text).toString(16) })),
        ),
      )
    const current = yield* Ref.make(
      yield* read.pipe(
        Effect.mapError((cause) => new Error(`REN_MODELS_FILE ${file} is not a valid model list`, { cause })),
        Effect.orDie,
      ),
    )
    yield* fs.watch(path.dirname(file)).pipe(
      Stream.filter((event) => path.basename(event.path) === path.basename(file)),
      Stream.debounce("200 millis"),
      Stream.runForEach(() =>
        read.pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.logError("REN_MODELS_FILE changed to an invalid model list; Ren keeps the last valid one", error),
            onSuccess: (loaded) =>
              Ref.set(current, loaded).pipe(Effect.andThen(Effect.logInfo("Reloaded REN_MODELS_FILE"))),
          }),
        ),
      ),
      Effect.forkScoped,
    )
    return Service.of({
      catalog: Effect.fn("Models.catalog")(function* () {
        return Models.catalog((yield* Ref.get(current)).access)
      }),
      revision: Effect.map(Ref.get(current), (loaded) => loaded.revision),
      grant: Effect.fn("Models.grant")(function* () {
        const access = (yield* Ref.get(current)).access
        const expiresAt = DateTime.addDuration(yield* DateTime.now, keyLifetime)
        return Models.Access.make({
          endpoints: access.endpoints.map((endpoint) =>
            Struct.evolve(endpoint, { apiKey: (apiKey) => ({ key: apiKey.key, expiresAt }) }),
          ),
        })
      }),
      inference: Effect.succeedNone,
    })
  }),
)

const refreshEvery = Duration.seconds(30)

// oxlint-disable-next-line ren/no-comments -- OpenCode and LiteLLM's OpenAI and Anthropic routes add their API path to a base URL that ends in /v1.
const apiUrl = (root: string) => `${root}/v1`

// oxlint-disable-next-line ren/no-comments -- HR28: the picker, the model checks and every brain read the same /model/info, through Models.fromLiteLLM. Ren reads it every 30 s and keeps its last list when LiteLLM fails. Until Ren mints a key per brain, each grant is REN_LITELLM_KEY with a 6 h expiry, so all spend goes to that key.
export const layerLiteLLM = Layer.effect(
  Service,
  Effect.gen(function* () {
    const root = (yield* Config.String("REN_LITELLM_URL")).replace(/\/+$/u, "")
    const brainRoot = (yield* Config.String("REN_LITELLM_BRAIN_URL").pipe(Config.withDefault(root))).replace(
      /\/+$/u,
      "",
    )
    const key = yield* Config.Redacted("REN_LITELLM_KEY")
    const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
    const read = http
      .execute(HttpClientRequest.get(`${root}/model/info`).pipe(HttpClientRequest.bearerToken(Redacted.value(key))))
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Models.LiteLLMModelInfo)),
        Effect.timeout(Duration.seconds(10)),
        Effect.map(Models.fromLiteLLM),
      )
    const current = yield* Ref.make(Option.none<Models.Catalog>())
    const load = read.pipe(
      Effect.tap((catalog) => Ref.set(current, Option.some(catalog))),
      Effect.tapError((error) =>
        Effect.logWarning("LiteLLM's model list could not be read; Ren keeps its last list", error),
      ),
    )
    yield* load.pipe(Effect.ignore, Effect.repeat(Schedule.spaced(refreshEvery)), Effect.forkScoped)
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
