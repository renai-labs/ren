export * as TestIssuer from "./issuer.js"

import { Brain } from "@ren/schema/brain"
import { SessionToken } from "@ren/host-api/session-token"
import { TestToken } from "@ren/cell/testing"
import { Auth } from "@ren/schema/auth"
import { Environment } from "@ren/schema/environment"
import type { Models } from "@ren/schema/models"
import { Session } from "@ren/schema/session"
import { Effect, Option, Redacted, Schema } from "effect"

interface Call {
  readonly endpoint: "models.refresh" | "environments.access" | "host.refresh"
  readonly hostToken: string | undefined
  readonly status: number
}

type Reply = { readonly type: "grant"; readonly access: Models.Access } | { readonly type: "unavailable" }

type Environments = (sessionId: Session.ID) => Promise<Environment.Access | undefined>

export interface Instance {
  readonly url: string
  readonly calls: ReadonlyArray<Call>
  readonly issue: (sessionId: Session.ID) => Promise<string>
  readonly next: (reply: () => Reply) => void
  readonly rotate: (on: boolean) => void
  readonly environments: (answer: Environments) => void
  readonly stop: () => Promise<void>
}

const encodeModels = Schema.encodeSync(Schema.toCodecJson(Brain.ModelGrant))

const encodeAccess = Schema.encodeSync(Schema.toCodecJson(Environment.Access))

const organizationId = Auth.OrganizationID.create()

const sign = (sid: Session.ID) =>
  Effect.runPromise(
    SessionToken.sign(TestToken.keys[0], {
      sid,
      scope: "host",
      org: organizationId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600 + Math.floor(Math.random() * 60),
    }),
  )

const sessionOf = (token: string) =>
  Effect.runPromise(SessionToken.verify(TestToken.keys, token)).then((claims) =>
    Option.getOrUndefined(Option.map(claims, (found) => found.sid)),
  )

export const start = (): Instance => {
  const valid = new Set<string>()
  const calls: Array<Call> = []
  const state: { reply: () => Reply; rotate: boolean; environments: Environments } = {
    reply: () => ({ type: "unavailable" }),
    rotate: false,
    environments: () => Promise.resolve(undefined),
  }
  const answer = (endpoint: Call["endpoint"], status: number, body: unknown, presented: string | undefined) => {
    calls.push({ endpoint, hostToken: presented, status })
    return Response.json(body, { status })
  }
  const serve = async (endpoint: Call["endpoint"], presented: string): Promise<Response> => {
    const sessionId = await sessionOf(presented)
    if (endpoint === "environments.access") {
      const access = sessionId && (await state.environments(Session.ID.make(sessionId)))
      if (!access)
        return answer(
          endpoint,
          404,
          { _tag: "EnvironmentNotFoundError", message: "The session has no environment" },
          presented,
        )
      return answer(endpoint, 200, encodeAccess(access), presented)
    }
    const next = state.rotate && sessionId ? await sign(sessionId) : presented
    if (state.rotate) {
      valid.delete(presented)
      valid.add(next)
    }
    if (endpoint === "host.refresh") return answer(endpoint, 200, { hostToken: next }, presented)
    const reply = state.reply()
    if (reply.type === "unavailable")
      return answer(endpoint, 503, { _tag: "ModelsUnavailableError", message: "The issuer is unavailable" }, presented)
    return answer(endpoint, 200, encodeModels({ access: reply.access, hostToken: Redacted.make(next) }), presented)
  }
  const sync = async (pathname: string, presented: string | undefined) => {
    if (!presented || !(await sessionOf(presented)))
      return Response.json({ _tag: "ForbiddenError", message: "The host token is not valid" }, { status: 403 })
    if (pathname === "/host/sync/checkpoints" || pathname === "/host/sync/restore")
      return Response.json({ sessions: [] })
    return Response.json({ _tag: "ForbiddenError", message: "The issuer keeps no sessions" }, { status: 403 })
  }
  const endpoints: Readonly<Record<string, Call["endpoint"]>> = {
    "/host/models/refresh": "models.refresh",
    "/host/environment/access": "environments.access",
    "/host/token/refresh": "host.refresh",
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: (request) => {
      const pathname = new URL(request.url).pathname
      const presented = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
      if (pathname.startsWith("/host/sync/") && request.method === "POST") return sync(pathname, presented)
      const endpoint = endpoints[pathname]
      if (!endpoint || request.method !== "POST") return new Response(null, { status: 404 })
      if (!presented || !valid.has(presented))
        return answer(endpoint, 403, { _tag: "ForbiddenError", message: "The host token is not valid" }, presented)
      return serve(endpoint, presented)
    },
  })
  return {
    url: `http://127.0.0.1:${server.port ?? 0}`,
    calls,
    issue: async (sessionId) => {
      const value = await sign(sessionId)
      valid.add(value)
      return value
    },
    next: (reply) => {
      state.reply = reply
    },
    rotate: (on) => {
      state.rotate = on
    },
    environments: (answerWith) => {
      state.environments = answerWith
    },
    stop: () => server.stop(true),
  }
}
