export * as OpenCodeMcp from "./mcp.js"

import type { Plugin } from "@opencode/plugin/effect"
import { Mcp } from "@opencode/schema/mcp"
import type { AppCatalog } from "@ren/schema/app-catalog"
import { Effect, Option, Schedule } from "effect"

// oxlint-disable-next-line ren/no-comments -- OpenCode 2.0.27 waits 30 seconds for each of startup and tools/list when a server declares no timeout.
const openCodeTimeout = 30_000

// oxlint-disable-next-line ren/no-comments -- OpenCode publishes a connected server's tools about 100 ms after it connects, and sends no event when it does.
const published = "1 second"

const checks = Schedule.spaced("25 millis")

export interface Server {
  readonly name: string
  readonly config: Mcp.RemoteConfig
  readonly within: number
}

export const servers = (apps: Option.Option<AppCatalog.Info>): ReadonlyArray<Server> => {
  const mcps: ReadonlyArray<AppCatalog.McpEntry> = Option.match(apps, {
    onNone: () => [],
    onSome: (info) => info.catalog.mcps,
  })
  return mcps.flatMap((entry) => {
    const declaration = entry.declaration
    if (
      declaration.transport.type !== "remote" ||
      declaration.auth.type !== "none" ||
      !declaration.requiredCredentials.every((requirement) => requirement.optional)
    )
      return []
    return [
      {
        name: entry.slug,
        config: new Mcp.RemoteConfig({
          type: "remote",
          url: declaration.transport.url,
          oauth: false,
          ...(declaration.timeouts && { timeout: new Mcp.TimeoutConfig(declaration.timeouts) }),
        }),
        within: (declaration.timeouts?.startup ?? openCodeTimeout) + (declaration.timeouts?.catalog ?? openCodeTimeout),
      },
    ]
  })
}

const namespace = (name: string) => name.replaceAll(/[^A-Za-z0-9_-]/gu, "_")

export const ready = Effect.fn("OpenCodeMcp.ready")(function* (
  context: Pick<Plugin.Context, "mcp" | "tool">,
  before: ReadonlyArray<Server>,
  after: ReadonlyArray<Server>,
) {
  const statuses = context.mcp.list().pipe(
    Effect.orDie,
    Effect.map((listed) => new Map(listed.data.map((server) => [server.name, server.status.status]))),
  )
  const connecting = yield* statuses.pipe(
    Effect.map((all) => after.filter((server) => (all.get(server.name) ?? "pending") === "pending")),
    Effect.repeat({ schedule: checks, until: (pending) => pending.length === 0 }),
    Effect.timeoutOption(Math.max(0, ...after.map((server) => server.within))),
  )
  if (Option.isNone(connecting))
    yield* Effect.logWarning(
      `App MCP servers did not finish connecting in time: ${after.map((server) => server.name).join(", ")}`,
    )
  const all = yield* statuses
  const connected = after
    .filter((server) => all.get(server.name) === "connected")
    .map((server) => namespace(server.name))
  const names = new Set(after.map((server) => server.name))
  const removed = before.filter((server) => !names.has(server.name)).map((server) => namespace(server.name))
  yield* context.tool.list().pipe(
    Effect.map((tools) => new Set(tools.flatMap((tool) => (tool.options?.namespace ? [tool.options.namespace] : [])))),
    Effect.repeat({
      schedule: checks,
      until: (listed) => connected.every((each) => listed.has(each)) && !removed.some((each) => listed.has(each)),
    }),
    Effect.timeoutOption(published),
  )
})
