export * as FakeRen from "./ren.js"

import { HostApi, CurrentHost, HostAuthentication } from "@ren/brain-api/host-api"
import {
  EnvironmentNotFoundError,
  EnvironmentUnavailableError,
  ForbiddenError,
  ModelsUnavailableError,
} from "@ren/brain-api/errors"
import { SessionToken } from "@ren/brain-api/session-token"
import { Auth } from "@ren/schema/auth"
import type { Environment } from "@ren/schema/environment"
import type { Session } from "@ren/schema/session"
import { Effect, Layer, Option, Redacted } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { TestToken } from "./token.js"

export type Answer =
  | { readonly type: "access"; readonly access: Environment.Access }
  | { readonly type: "not_found" }
  | { readonly type: "unavailable"; readonly message: string }
  | { readonly type: "hold" }

export interface Call {
  readonly endpoint: "environments.access" | "host.refresh" | "models.refresh"
  readonly sessionId: Session.ID | undefined
  readonly hostToken: string
  readonly status: number
}

const organizationId = Auth.OrganizationID.create()

export const hostToken = (sessionId: Session.ID, lifetimeSeconds = 3600, key: SessionToken.Key = TestToken.keys[0]) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const now = Math.floor(Date.now() / 1000)
      return yield* SessionToken.sign(key, {
        sid: sessionId,
        scope: "host",
        org: organizationId,
        iat: now,
        exp: now + lifetimeSeconds,
      })
    }),
  )

export const start = () => {
  const answers = new Map<Session.ID, () => Answer | Promise<Answer>>()
  const calls: Array<Call> = []
  const held: Array<() => void> = []
  const state = { refuseHosts: false, refreshGate: undefined as (() => Promise<void>) | undefined }
  const presented = { token: "" }
  const listeners = new Set<() => void>()
  const record = (endpoint: Call["endpoint"], sessionId: Session.ID | undefined, status: number) => {
    calls.push({ endpoint, sessionId, hostToken: presented.token, status })
    for (const listener of listeners) listener()
  }
  const handlers = Layer.mergeAll(
    HttpApiBuilder.group(HostApi, "environments", (group) =>
      Effect.succeed(
        group.handle("environments.access", () =>
          Effect.gen(function* () {
            const host = yield* CurrentHost
            const answer = yield* Effect.promise(async (): Promise<Answer> =>
              (answers.get(host.brainId) ?? (() => ({ type: "not_found" }) as const))(),
            )
            if (answer.type === "hold") {
              record("environments.access", host.brainId, 0)
              return yield* Effect.callback<never>((resume) => {
                held.push(() => resume(Effect.never))
              })
            }
            if (answer.type === "not_found") {
              record("environments.access", host.brainId, 404)
              return yield* new EnvironmentNotFoundError({ message: `Session ${host.brainId} has no environment` })
            }
            if (answer.type === "unavailable") {
              record("environments.access", host.brainId, 503)
              return yield* new EnvironmentUnavailableError({ message: answer.message })
            }
            record("environments.access", host.brainId, 200)
            return answer.access
          }),
        ),
      ),
    ),
    HttpApiBuilder.group(HostApi, "host", (group) =>
      Effect.succeed(
        group.handle("host.refresh", () =>
          Effect.gen(function* () {
            const host = yield* CurrentHost
            record("host.refresh", host.brainId, 200)
            yield* Effect.promise(() => state.refreshGate?.() ?? Promise.resolve())
            return { hostToken: yield* Effect.promise(() => hostToken(host.brainId)) }
          }),
        ),
      ),
    ),
    HttpApiBuilder.group(HostApi, "models", (group) =>
      Effect.succeed(
        group.handle("models.refresh", () =>
          Effect.gen(function* () {
            const host = yield* CurrentHost
            record("models.refresh", host.brainId, 503)
            return yield* new ModelsUnavailableError({ message: "The fake Ren grants no models" })
          }),
        ),
      ),
    ),
  )
  const authentication = Layer.succeed(
    HostAuthentication,
    HostAuthentication.of({
      bearer: (httpEffect, options) =>
        Effect.gen(function* () {
          presented.token = Redacted.value(options.credential)
          const claims = yield* SessionToken.verify(TestToken.keys, Redacted.value(options.credential))
          const host = Option.filter(claims, (found) => found.scope === "host" && !state.refuseHosts)
          if (Option.isNone(host) || host.value.scope !== "host")
            return yield* new ForbiddenError({ message: "The host token is not valid" })
          return yield* httpEffect.pipe(
            Effect.provideService(CurrentHost, { brainId: host.value.sid, organizationId: host.value.org }),
          )
        }),
    }),
  )
  const api = HttpRouter.toWebHandler(
    HttpApiBuilder.layer(HostApi).pipe(
      Layer.provide(handlers),
      Layer.provide(authentication),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  )
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: (request) => api.handler(request) })
  return {
    url: `http://127.0.0.1:${server.port ?? 0}`,
    calls,
    answer: (sessionId: Session.ID, answer: () => Answer | Promise<Answer>) => {
      answers.set(sessionId, answer)
    },
    refuseHosts: (refusing: boolean) => {
      state.refuseHosts = refusing
    },
    holdRefresh: (gate: (() => Promise<void>) | undefined) => {
      state.refreshGate = gate
    },
    accessCalls: (sessionId: Session.ID) =>
      calls.filter((call) => call.endpoint === "environments.access" && call.sessionId === sessionId).length,
    reached: (sessionId: Session.ID, count = 1) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (calls.filter((call) => call.sessionId === sessionId).length < count) return
          listeners.delete(check)
          resolve()
        }
        listeners.add(check)
        check()
      }),
    stop: async () => {
      for (const release of held) release()
      await server.stop(true)
      await api.dispose()
    },
  }
}

export type Instance = ReturnType<typeof start>
