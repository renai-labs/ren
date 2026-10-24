export * as Models from "./models.js"

import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import {
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Path,
  Redacted,
  Ref,
  Schema,
  Stream,
  Struct,
} from "effect"

export { Access, Catalog, Endpoint, catalog } from "@ren/schema/models"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Models.Unavailable", {
  cause: Schema.Defect(),
}) {}

export interface Interface {
  readonly catalog: (organizationId: Auth.OrganizationID) => Effect.Effect<Models.Catalog, Unavailable>
  readonly grant: (brainId: Brain.ID, organizationId: Auth.OrganizationID) => Effect.Effect<Models.Access, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Models") {}

export const keyLifetime = Duration.hours(6)

const encodeAccess = Schema.encodeSync(Models.Access)

export const hash = Effect.fn("Models.hash")(function* (access: Models.Access) {
  const encoded = encodeAccess(access)
  const content = JSON.stringify({
    endpoints: encoded.endpoints.map((endpoint) => Struct.omit(endpoint, ["apiKey"])),
  })
  const digest = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
})

export const layerNone = Layer.succeed(
  Service,
  Service.of({
    catalog: Effect.fn("Models.catalog")(function* () {
      return { endpoints: [] }
    }),
    grant: Effect.fn("Models.grant")(function* () {
      return Models.Access.make({ endpoints: [] })
    }),
  }),
)

const decodeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(Models.Access))

export const layerConfig = Layer.effect(
  Service,
  Effect.gen(function* () {
    const file = yield* Config.String("REN_MODELS_FILE")
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const read = fs.readFileString(file).pipe(Effect.flatMap(decodeFile))
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
            onSuccess: (access) =>
              Ref.set(current, access).pipe(Effect.andThen(Effect.logInfo("Reloaded REN_MODELS_FILE"))),
          }),
        ),
      ),
      Effect.forkScoped,
    )
    return Service.of({
      catalog: Effect.fn("Models.catalog")(function* () {
        return Models.catalog(yield* Ref.get(current))
      }),
      grant: Effect.fn("Models.grant")(function* () {
        const access = yield* Ref.get(current)
        const expiresAt = DateTime.addDuration(yield* DateTime.now, keyLifetime)
        return Models.Access.make({
          endpoints: access.endpoints.map((endpoint) =>
            Struct.evolve(endpoint, { apiKey: (apiKey) => ({ key: apiKey.key, expiresAt }) }),
          ),
        })
      }),
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- Behind an egress a brain holds no model key: each endpoint gets the placeholder ren:MODELS and no expiry, so the brain never renews it. The egress puts in the real key that Ren mints (CredentialSource.layerMinted).
export const placeholderKey = "ren:MODELS"

export const layerPlaceholders = Layer.effect(
  Service,
  Effect.gen(function* () {
    const models = yield* Service
    return Service.of({
      catalog: models.catalog,
      grant: Effect.fn("Models.grant")(function* (brainId, organizationId) {
        const access = yield* models.grant(brainId, organizationId)
        return Models.Access.make({
          endpoints: access.endpoints.map((endpoint) =>
            Struct.evolve(endpoint, { apiKey: () => ({ key: Redacted.make(placeholderKey) }) }),
          ),
        })
      }),
    })
  }),
)
