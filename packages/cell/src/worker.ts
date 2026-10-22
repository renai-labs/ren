import { Option, Effect, Schema } from "effect"
import { Chat } from "./chat.js"
import { Entry } from "./entry.js"
import { Env } from "./env.js"
import type { SessionCell } from "./session-cell.js"

export { SessionCell } from "./session-cell.js"

interface Bindings {
  readonly SESSION_CELL: DurableObjectNamespace<SessionCell>
}

const forward = (request: Request, env: Bindings) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const vars = yield* Schema.decodeUnknownEffect(Env.Vars)(env).pipe(Effect.orDie)
      const checked = yield* Entry.check(request, {
        keys: Effect.succeed(vars.BRAIN_PUBLIC_KEYS),
        brain: Option.none(),
        generation: 1,
      })
      if (checked instanceof Response) return checked
      return yield* Effect.promise(() => env.SESSION_CELL.getByName(checked.brain).fetch(checked.request))
    }),
  )

// oxlint-disable-next-line import/no-default-export -- workerd, celld and Cloudflare load the worker's default export
export default {
  fetch: (request, env) => {
    const isChat = Chat.owns(new URL(request.url).pathname)
    if (isChat && request.method === "OPTIONS") return new Response(null, { status: 204, headers: Entry.cors })
    return forward(request, env).then((response) => (isChat ? Entry.withCors(response) : response))
  },
} satisfies ExportedHandler<Bindings>
