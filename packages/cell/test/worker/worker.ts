import { DurableObject } from "cloudflare:workers"
import { Effect, Option } from "effect"
import { Host } from "../../src/harness/opencode/host.js"
import { Token } from "../../src/token.js"

interface Env {
  readonly SESSION_CELL: DurableObjectNamespace<SessionCell>
  readonly OPENCODE_CONFIG: string
}

export class SessionCell extends DurableObject<Env> {
  host: Promise<Host.Instance> | undefined

  override async fetch(request: Request) {
    if (new URL(request.url).pathname === "/test/close") {
      const host = this.host
      this.host = undefined
      if (host) await Effect.runPromise((await host).close)
      return new Response(null, { status: 204 })
    }
    this.host ??= Effect.runPromise(Host.open(this.ctx.storage, this.env.OPENCODE_CONFIG))
    return (await this.host).fetch(request)
  }
}

// oxlint-disable-next-line import/no-default-export -- workerd, celld and Cloudflare load the worker's default export
export default {
  fetch: (request, env) =>
    Option.match(Token.read(request.headers.get("authorization")), {
      onNone: () => new Response(null, { status: 401 }),
      onSome: (name) => env.SESSION_CELL.getByName(name).fetch(request),
    }),
} satisfies ExportedHandler<Env>
