export * as TestIssuer from "./issuer.js"

import { ModelsBody } from "@ren/brain-api/brain-api"
import type { Models } from "@ren/schema/models"
import { Schema } from "effect"

interface Call {
  readonly hostToken: string | undefined
  readonly status: number
}

type Reply = { readonly type: "grant"; readonly access: Models.Access } | { readonly type: "unavailable" }

export interface Instance {
  readonly url: string
  readonly calls: ReadonlyArray<Call>
  readonly issue: () => string
  readonly next: (reply: () => Reply) => void
  readonly rotate: (on: boolean) => void
  readonly stop: () => Promise<void>
}

const encode = Schema.encodeSync(ModelsBody)

const hostToken = () => `host-${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "")

export const start = (): Instance => {
  const valid = new Set<string>()
  const calls: Array<Call> = []
  const state: { reply: () => Reply; rotate: boolean } = { reply: () => ({ type: "unavailable" }), rotate: false }
  const answer = (status: number, body: unknown, presented: string | undefined) => {
    calls.push({ hostToken: presented, status })
    return Response.json(body, { status })
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: (request) => {
      if (new URL(request.url).pathname !== "/brain/models/refresh" || request.method !== "POST")
        return new Response(null, { status: 404 })
      const presented = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]
      if (!presented || !valid.has(presented))
        return answer(403, { _tag: "ForbiddenError", message: "The host token is not valid" }, presented)
      const reply = state.reply()
      if (reply.type === "unavailable")
        return answer(503, { _tag: "ModelsUnavailableError", message: "The issuer is unavailable" }, presented)
      const next = state.rotate ? hostToken() : presented
      if (state.rotate) {
        valid.delete(presented)
        valid.add(next)
      }
      return answer(200, encode({ access: reply.access, hostToken: next }), presented)
    },
  })
  return {
    url: `http://127.0.0.1:${server.port ?? 0}`,
    calls,
    issue: () => {
      const value = hostToken()
      valid.add(value)
      return value
    },
    next: (reply) => {
      state.reply = reply
    },
    rotate: (on) => {
      state.rotate = on
    },
    stop: () => server.stop(true),
  }
}
