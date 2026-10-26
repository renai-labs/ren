export * as ApiFixture from "./api-fixture.js"

import { Seed } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { getCookies } from "better-auth/cookies"
import { makeSignature } from "better-auth/crypto"
import { Clock, Context, Effect, Layer } from "effect"
import { call, config, makeApp } from "./app.js"

export interface Interface {
  readonly handler: (request: Request) => Promise<Response>
}

export class Service extends Context.Service<Service, Interface>()("@ren/server/test/ApiFixture") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* Effect.context<Layer.Success<typeof Testing.layer>>()
    return yield* Effect.acquireRelease(
      Effect.sync(() => makeApp(undefined, { database: Layer.succeedContext(context) })),
      (app) => Effect.promise(() => app.dispose()),
    )
  }),
).pipe(Layer.provideMerge(Testing.layer))

export const owner = Effect.fn("ApiFixture.owner")(function* () {
  const api = yield* Service
  const database = yield* Database.Service
  const owner = yield* Seed.owner()
  const now = yield* Clock.currentTimeMillis
  const token = crypto.randomUUID()
  yield* database.db.insert(Database.Schema.session).values({
    id: Auth.SessionID.create(),
    token,
    userId: owner.createdBy,
    activeOrganizationId: owner.organizationId,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    expiresAt: new Date(now + 60 * 60 * 1000),
  })
  const signature = yield* Effect.promise(() => makeSignature(token, config.BETTER_AUTH_SECRET))
  const cookie = `${getCookies({ baseURL: config.BETTER_AUTH_URL }).sessionToken.name}=${encodeURIComponent(`${token}.${signature}`)}`
  return {
    ...owner,
    cookie,
    request: (method: string, path: string, body?: unknown) =>
      Effect.promise(() => call(api, cookie, method, path, body)),
  }
})
