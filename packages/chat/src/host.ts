export * as ChatHost from "./host.js"

import { Ren } from "@ren/client/effect"
import type { Session } from "@ren/schema/session"
import { SessionMessage } from "@ren/schema/session/message"
import { Effect, Layer, Option, Predicate, Schema } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { Atom } from "effect/reactivity"
import { ChatAtoms } from "./atoms.js"
import { Outbox } from "./outbox.js"

export interface Storage {
  readonly get: (key: string) => string | undefined
  readonly set: (key: string, value: string) => void
  readonly remove: (key: string) => void
}

export interface Cache {
  readonly read: (userId: string, sessionID: string) => Promise<string | void>
  readonly write: (
    userId: string,
    sessionID: string,
    entry: { readonly body: string; readonly tier: number },
  ) => Promise<void>
  readonly remove: (userId: string, sessionID: string) => Promise<void>
  readonly forget: (keep?: string) => Promise<void>
}

export interface Options {
  readonly serverUrl: string
  readonly userId: string
  readonly storage: Storage
  readonly cache?: Cache | undefined
  readonly fetch?: typeof globalThis.fetch | undefined
  readonly chatFetch?: typeof globalThis.fetch | undefined
  readonly lifecycle?: ((listener: (event: ChatAtoms.Lifecycle) => void) => () => void) | undefined
}

const Kept = Schema.fromJsonString(Schema.Array(Outbox.Kept))

const Cached = Schema.fromJsonString(Schema.Array(SessionMessage.Info))

const chatBytes = 5 * 1024 * 1024

const fitted = (messages: ReadonlyArray<SessionMessage.Info>): string | undefined => {
  const body = Schema.encodeSync(Cached)(messages)
  if (body.length <= chatBytes) return body
  return messages.length > 1 ? fitted(messages.slice(Math.ceil(messages.length / 4))) : undefined
}

function cacheFor(cache: Cache, userId: string) {
  return (sessionID: Session.ID) => ({
    read: Effect.promise(() => cache.read(userId, sessionID)).pipe(
      Effect.map((body) =>
        typeof body === "string" ? Option.getOrUndefined(Schema.decodeUnknownOption(Cached)(body)) : undefined,
      ),
    ),
    write: (messages: ReadonlyArray<SessionMessage.Info>) =>
      Effect.promise(() => {
        const body = fitted(messages)
        const sent = messages.some((message) => message.type === "user" && message.sender?.userId === userId)
        return body ? cache.write(userId, sessionID, { body, tier: sent ? 2 : 3 }) : Promise.resolve()
      }),
  })
}

const fetchLayer = (fetch: typeof globalThis.fetch | undefined) =>
  fetch ? Layer.merge(FetchHttpClient.layer, Layer.succeed(FetchHttpClient.Fetch, fetch)) : FetchHttpClient.layer

export const make = (options: Options) => {
  const server = Layer.merge(fetchLayer(options.fetch), Layer.succeed(HttpClient.TracerPropagationEnabled, false))
  const ren = Ren.make({ baseUrl: options.serverUrl })
  const cache = options.cache
  return ChatAtoms.make({
    runtime: Atom.runtime(fetchLayer(options.chatFetch)),
    sender: { userId: options.userId },
    ...(options.lifecycle && { lifecycle: options.lifecycle }),
    access: (sessionID: Session.ID, input: { readonly unreachable: boolean }) =>
      ren.pipe(
        Effect.flatMap((client) =>
          client.chat.access({ id: sessionID, ...(input.unreachable && { unreachable: "true" as const }) }),
        ),
        Effect.tapError((error) =>
          Predicate.isTagged(error, "NotFoundError") && cache
            ? Effect.promise(() => cache.remove(options.userId, sessionID))
            : Effect.void,
        ),
        Effect.provide(server),
      ),
    ...(cache && { cache: cacheFor(cache, options.userId) }),
    restart: (sessionID: Session.ID) =>
      ren.pipe(
        Effect.flatMap((client) => client.chat.retry({ id: sessionID })),
        Effect.asVoid,
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
