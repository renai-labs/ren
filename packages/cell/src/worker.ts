import { Effect, Option, Schema } from "effect"
import { Env } from "./env.js"
import type { SessionCell } from "./session-cell.js"
import { Token } from "./token.js"

export { SessionCell } from "./session-cell.js"

const serverOnly = [
  /^\/(cell|ren)(\/|$)/,
  /^\/api\/credential(\/|$)/,
  /^\/api\/integration\/[^/]+\/connect(\/|$)/,
  /^\/api\/experimental\/integration(\/|$)/,
]

interface Bindings {
  readonly SESSION_CELL: DurableObjectNamespace<SessionCell>
}

// oxlint-disable-next-line import/no-default-export -- workerd, celld and Cloudflare load the worker's default export
export default {
  fetch: (request, env) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const vars = yield* Schema.decodeUnknownEffect(Env.Vars)(env).pipe(Effect.orDie)
        const claims = yield* Effect.fromOption(Token.read(request.headers.get("authorization"))).pipe(
          Effect.flatMap((token) => Token.verify(vars.CELL_KEYS, token)),
          Effect.option,
        )
        if (Option.isNone(claims))
          return Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 })
        const path = new URL(request.url).pathname
        if (serverOnly.some((pattern) => pattern.test(path)) && claims.value.scope !== "server")
          return new Response(null, { status: 403 })
        const headers = new Headers(request.headers)
        headers.delete("authorization")
        return yield* Effect.promise(() =>
          env.SESSION_CELL.getByName(claims.value.sid).fetch(new Request(request, { headers })),
        )
      }),
    ),
} satisfies ExportedHandler<Bindings>
