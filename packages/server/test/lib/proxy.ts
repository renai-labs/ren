export * as Proxy from "./proxy.js"

import { Effect } from "effect"

export interface Request {
  readonly method: string
  readonly path: string
}

export interface Rule {
  readonly match: (request: Request) => boolean
  readonly fault?: "fail" | "lose"
  readonly before?: () => Promise<unknown>
  readonly after?: (response: Response) => unknown
}

export const make = (target: string, options: { readonly hostname?: string; readonly port?: number } = {}) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const requests: Array<Request> = []
      const rules: Array<Rule> = []
      const observers: Array<(request: Request, status: number) => void> = []
      const serve = (port: number) =>
        Bun.serve({
          hostname: options.hostname ?? "127.0.0.1",
          port,
          fetch: async (incoming) => {
            const url = new URL(incoming.url)
            const request = { method: incoming.method, path: url.pathname }
            requests.push(request)
            const index = rules.findIndex((rule) => rule.match(request))
            const rule = index === -1 ? undefined : rules.splice(index, 1)[0]
            await rule?.before?.()
            if (rule?.fault === "fail") return new Response("The proxy failed the request", { status: 503 })
            const response = await fetch(`${target}${url.pathname}${url.search}`, {
              method: incoming.method,
              headers: incoming.headers,
              ...(incoming.method !== "GET" && { body: await incoming.arrayBuffer() }),
            })
            await rule?.after?.(response.clone())
            for (const observe of observers) observe(request, response.status)
            if (rule?.fault !== "lose") return response
            await response.arrayBuffer()
            return new Response("The proxy lost the reply", { status: 502 })
          },
        })
      const state = { server: serve(options.port ?? 0) }
      const port = state.server.port ?? 0
      return {
        url: state.server.url.origin,
        requests,
        once: (rule: Rule) => void rules.push(rule),
        observe: (observe: (request: Request, status: number) => void) => void observers.push(observe),
        clear: () => void requests.splice(0),
        down: () => state.server.stop(true),
        up: () => {
          state.server = serve(port)
        },
        stop: () => state.server.stop(true),
      }
    }),
    (proxy) => Effect.promise(proxy.stop),
  )
