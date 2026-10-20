import { SessionToken } from "@ren/host-api/session-token"
import { Session } from "@ren/schema/session"
import { Effect, Option, Schema } from "effect"
import { Chat } from "./chat.js"
import { Env } from "./env.js"
import type { SessionCell } from "./session-cell.js"
import { Token } from "./token.js"

export { SessionCell } from "./session-cell.js"

interface Bindings {
  readonly SESSION_CELL: DurableObjectNamespace<SessionCell>
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "86400",
}

const withCors = (response: Response) => {
  const headers = new Headers(response.headers)
  headers.set("access-control-allow-origin", "*")
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const forward = (request: Request, env: Bindings, options: { readonly isChat: boolean }) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const vars = yield* Schema.decodeUnknownEffect(Env.Vars)(env).pipe(Effect.orDie)
      const claims = yield* Option.match(Token.read(request.headers.get("authorization")), {
        onNone: () => Effect.succeedNone,
        onSome: (token) =>
          SessionToken.verify(vars.CELL_KEYS, token).pipe(
            Effect.map(
              Option.flatMap((verified) => (verified.scope === "host" ? Option.none() : Option.some(verified))),
            ),
          ),
      })
      if (Option.isNone(claims))
        return Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 })
      if (claims.value.scope !== "server" && !options.isChat) return new Response(null, { status: 403 })
      const headers = new Headers(request.headers)
      headers.delete("authorization")
      Chat.setMember(headers, claims.value)
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
  )

// oxlint-disable-next-line import/no-default-export -- workerd, celld and Cloudflare load the worker's default export
export default {
  fetch: (request, env) => {
    const isChat = Chat.owns(new URL(request.url).pathname)
    if (isChat && request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })
    return forward(request, env, { isChat }).then((response) => (isChat ? withCors(response) : response))
  },
} satisfies ExportedHandler<Bindings>
