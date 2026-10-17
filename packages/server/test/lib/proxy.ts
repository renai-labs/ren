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
}

export const make = (target: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const requests: Array<Request> = []
      const rules: Array<Rule> = []
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
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
          if (rule?.fault !== "lose") return response
          await response.arrayBuffer()
          return new Response("The proxy lost the reply", { status: 502 })
        },
      })
      return {
        url: server.url.origin,
        requests,
        once: (rule: Rule) => void rules.push(rule),
        clear: () => void requests.splice(0),
        stop: () => server.stop(true),
      }
    }),
    (proxy) => Effect.promise(proxy.stop),
  )
