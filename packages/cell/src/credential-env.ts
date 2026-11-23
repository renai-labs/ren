export * as CredentialEnv from "./credential-env.js"

import type { HandConnections } from "@ren/brain/hand/connections"
import type { PullChat } from "@ren/host-api/ren-host-api"
import type { Session } from "@ren/schema/session"
import { Context, Effect, Layer, Ref } from "effect"

export interface Interface {
  readonly current: Effect.Effect<HandConnections.Env>
  readonly of: (sessionId: Session.ID) => Effect.Effect<HandConnections.Env>
  readonly apply: (env: HandConnections.Env, chats: ReadonlyArray<PullChat>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/CredentialEnv") {}

// oxlint-disable-next-line ren/no-comments -- HR18: the env vars of each pull apply at once, a removal too. A process reads them when it starts, so a running one keeps its copy. REN_CO_AUTHORS gives the git hook of Ren's images the chat's co-authors, one per line.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* Ref.make<{
      readonly env: HandConnections.Env
      readonly coAuthors: ReadonlyMap<Session.ID, ReadonlyArray<string>>
    }>({ env: { variables: {}, placeholders: {} }, coAuthors: new Map() })
    return Service.of({
      current: Effect.map(Ref.get(state), (found) => found.env),
      of: (sessionId) =>
        Effect.map(Ref.get(state), (found) => {
          const coAuthors = found.coAuthors.get(sessionId) ?? []
          return coAuthors.length === 0
            ? found.env
            : { ...found.env, variables: { ...found.env.variables, REN_CO_AUTHORS: coAuthors.join("\n") } }
        }),
      apply: (env, chats) =>
        Ref.set(state, { env, coAuthors: new Map(chats.map((chat) => [chat.id, chat.coAuthors ?? []])) }),
    })
  }),
)
