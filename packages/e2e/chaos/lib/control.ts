export * as Control from "./control.js"

import { Environment } from "@ren/schema/environment"
import { Schema } from "effect"

const encodeAccess = Schema.encodeSync(Schema.toCodecJson(Environment.Access))

const decodeId = Schema.decodeUnknownOption(Environment.ID)

export interface Instance {
  readonly url: string
  readonly publish: (access: Environment.Access) => void
  readonly stop: () => Promise<void>
}

export const start = (): Instance => {
  const accesses = new Map<Environment.ID, Environment.Access>()
  const changes: Array<{ readonly version: number; readonly id: Environment.ID }> = []
  const waiters = new Set<() => void>()
  const version = () => changes.at(-1)?.version ?? 0
  const notify = (id: Environment.ID) => {
    changes.push({ version: version() + 1, id })
    for (const wake of waiters) wake()
    waiters.clear()
  }
  const since = (after: number) =>
    Response.json({
      version: version(),
      ids: [...new Set(changes.filter((change) => change.version > after).map((change) => change.id))],
    })
  const poll = async (after: number) => {
    if (version() > after) return since(after)
    const woken = Promise.withResolvers<void>()
    waiters.add(woken.resolve)
    const timer = setTimeout(woken.resolve, 20_000)
    await woken.promise
    clearTimeout(timer)
    waiters.delete(woken.resolve)
    return since(after)
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: (request) => {
      const parts = new URL(request.url).pathname.split("/").filter((part) => part !== "")
      if (request.method !== "GET" || parts[0] !== "environments" || parts[1] === undefined || parts.length > 2)
        return new Response(null, { status: 404 })
      if (parts[1] === "changes") return poll(Number(new URL(request.url).searchParams.get("after") ?? "0"))
      const id = decodeId(parts[1])
      const access = id._tag === "Some" ? accesses.get(id.value) : undefined
      return access ? Response.json(encodeAccess(access)) : new Response(null, { status: 404 })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port ?? 0}`,
    publish: (access) => {
      accesses.set(access.environmentId, access)
      notify(access.environmentId)
    },
    stop: async () => {
      for (const wake of waiters) wake()
      await server.stop(true)
    },
  }
}
