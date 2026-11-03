export * as ChatHost from "./host.js"

import { Ren } from "@ren/client/effect"
import type { Session } from "@ren/schema/session"
import { Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Atom } from "effect/reactivity"
import { ChatAtoms } from "./atoms.js"
import { Outbox } from "./outbox.js"

export interface Storage {
  readonly get: (key: string) => string | undefined
  readonly set: (key: string, value: string) => void
  readonly remove: (key: string) => void
}

export interface Options {
  readonly serverUrl: string
  readonly userId: string
  readonly storage: Storage
  readonly fetch?: typeof globalThis.fetch | undefined
  readonly chatFetch?: typeof globalThis.fetch | undefined
  readonly lifecycle?: ((listener: (event: ChatAtoms.Lifecycle) => void) => () => void) | undefined
}

const Kept = Schema.fromJsonString(Schema.Array(Outbox.Kept))

const fetchLayer = (fetch: typeof globalThis.fetch | undefined) =>
  fetch ? Layer.merge(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetch)) : FetchHttpClient.layer

export const make = (options: Options) => {
  const server = Layer.merge(fetchLayer(options.fetch), Layer.succeed(HttpClient.TracerPropagationEnabled, false))
  const ren = Ren.make({ baseUrl: options.serverUrl })
  return ChatAtoms.make({
    runtime: Atom.runtime(fetchLayer(options.chatFetch)),
    sender: { userId: options.userId },
    ...(options.lifecycle && { lifecycle: options.lifecycle }),
    access: (sessionID: Session.ID, input: { readonly unreachable: boolean }) =>
      ren.pipe(
        Effect.flatMap((client) =>
          client.chat.access({ id: sessionID, ...(input.unreachable && { unreachable: "true" as const }) }),
        ),
        Effect.provide(server),
      ),
    outbox: (sessionID: Session.ID) => {
      const key = `session.${sessionID}.outbox`
      return {
        load: Effect.sync(() =>
          Schema.decodeUnknownOption(Kept)(options.storage.get(key)).pipe(Option.getOrElse(() => [])),
        ),
        keep: (items: ReadonlyArray<Outbox.Kept>) =>
          Effect.sync(() =>
            items.length === 0 ? options.storage.remove(key) : options.storage.set(key, Schema.encodeSync(Kept)(items)),
          ),
      }
    },
    saved: (sessionID: Session.ID, query: { readonly limit: number }) =>
      ren.pipe(
        Effect.flatMap((client) => client.chat.messages({ id: sessionID, limit: query.limit })),
        Effect.provide(server),
      ),
  })
}
