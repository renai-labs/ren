import { SessionToken } from "@ren/host-api/session-token"
import { Session } from "@ren/schema/session"
import { Effect, Option, Schema } from "effect"
import { Brain } from "./brain.js"
import { Env } from "./env.js"
import { OpenCodeRoutes } from "./harness/opencode/routes.js"
import type { SessionCell } from "./session-cell.js"
import { Token } from "./token.js"

export { SessionCell } from "./session-cell.js"

interface Bindings {
  readonly SESSION_CELL: DurableObjectNamespace<SessionCell>
}

// oxlint-disable-next-line import/no-default-export -- workerd, celld and Cloudflare load the worker's default export
export default {
  fetch: (request, env) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const vars = yield* Schema.decodeUnknownEffect(Env.Vars)(env).pipe(Effect.orDie)
        const claims = yield* Option.match(Token.read(request.headers.get("authorization")), {
          onNone: () => Effect.succeedNone,
          onSome: (token) =>
            SessionToken.verify(vars.CELL_KEYS, token).pipe(
              Effect.map(Option.filter((verified) => verified.scope === "server" || verified.scope === "client")),
            ),
        })
        if (Option.isNone(claims))
          return Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 })
        const path = new URL(request.url).pathname
        const serverOnly = Brain.owns(path) || OpenCodeRoutes.serverOnly.some((pattern) => pattern.test(path))
        if (serverOnly && claims.value.scope !== "server") return new Response(null, { status: 403 })
        const headers = new Headers(request.headers)
        headers.delete("authorization")
        const oversized = Number(headers.get("content-length")) > Session.maxBodyBytes
        const chunks: Array<Uint8Array<ArrayBuffer>> = []
        const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = request.body?.getReader()
        let bytes = 0
        if (reader) {
          let chunk = yield* Effect.promise(() => reader.read())
          // oxlint-disable-next-line ren/no-comments -- Cancelling an oversized request body can break the next keep-alive request in workerd; drain excess bytes without retaining them.
          while (!chunk.done) {
            bytes += chunk.value.byteLength
            if (oversized || bytes > Session.maxBodyBytes) chunks.length = 0
            else chunks.push(new Uint8Array(chunk.value))
            chunk = yield* Effect.promise(() => reader.read())
          }
        }
        if (oversized || bytes > Session.maxBodyBytes) return new Response(null, { status: 413 })
        return yield* Effect.promise(() =>
          env.SESSION_CELL.getByName(claims.value.sid).fetch(
            new Request(request.url, {
              method: request.method,
              headers,
              body: reader ? new Blob(chunks) : null,
              signal: request.signal,
            }),
          ),
        )
      }),
    ),
} satisfies ExportedHandler<Bindings>
