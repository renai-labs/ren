export * as RenAddress from "./ren-address.js"

import { Context, Effect, Layer, Option, Ref } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { BrainStorage } from "./brain-storage.js"

const key = "ren:address"

export const header = "ren-address"

export interface Interface {
  readonly current: Effect.Effect<Option.Option<string>>
  readonly adopt: (address: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/RenAddress") {}

// oxlint-disable-next-line ren/no-comments -- Ren's address: the newest one a server token named, saved in brain.db, else REN_URL (E119).
export const layer = (configured: string | undefined) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const storage = yield* BrainStorage.Service
      const saved = yield* Effect.promise(() => storage.get(key))
      const address = yield* Ref.make(Option.fromNullishOr(saved ?? configured))
      return Service.of({
        current: Ref.get(address),
        adopt: Effect.fn("RenAddress.adopt")(function* (next: string) {
          if (Option.contains(yield* Ref.get(address), next)) return
          yield* Ref.set(address, Option.some(next))
          yield* Effect.promise(() => storage.put(key, next))
          yield* Effect.logInfo(`Ren's address is now ${next}`)
        }),
      })
    }),
  )

// oxlint-disable-next-line ren/no-comments -- Every call to Ren goes to its current address, whatever base URL the client was made with.
export const http = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const base = yield* HttpClient.HttpClient
    const address = yield* Service
    return HttpClient.transform(base, (sent, request) =>
      Effect.flatMap(
        address.current,
        Option.match({
          onNone: () => sent,
          onSome: (current) => {
            const target = new URL(current)
            const url = new URL(request.url)
            if (url.host === target.host && url.protocol === target.protocol) return sent
            url.protocol = target.protocol
            url.host = target.host
            return base.execute(HttpClientRequest.setUrl(request, url))
          },
        }),
      ),
    )
  }),
)
