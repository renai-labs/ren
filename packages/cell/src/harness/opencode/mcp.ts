export * as OpenCodeMcp from "./mcp.js"

import type { Plugin } from "@opencode/plugin/effect"
import { Mcp } from "@opencode/schema/mcp"
import type { AppCatalog } from "@ren/schema/app-catalog"
import { Effect, Option, Ref, Schedule } from "effect"
import type { OpenCodeExecution } from "./execution.js"

// oxlint-disable-next-line ren/no-comments -- OpenCode 2.0.27 waits 30 seconds for each of startup and tools/list when a server declares no timeout.
const openCodeTimeout = 30_000

// oxlint-disable-next-line ren/no-comments -- OpenCode publishes a connected server's tools about 100 ms after it connects, and sends no event when it does.
const published = "1 second"

const checks = Schedule.spaced("25 millis")

interface Server {
  readonly name: string
  readonly config: Mcp.RemoteConfig | Mcp.LocalConfig
  readonly within: number
}

const entries = (apps: Option.Option<AppCatalog.Info>): ReadonlyArray<AppCatalog.McpEntry> =>
  Option.match(apps, { onNone: () => [], onSome: (info) => info.catalog.mcps }).filter(
    (entry) =>
      entry.declaration.auth.type === "none" &&
      entry.declaration.requiredCredentials.every((requirement) => requirement.optional),
  )

const servers = (apps: Option.Option<AppCatalog.Info>, options: { readonly local: boolean }): ReadonlyArray<Server> =>
  entries(apps).flatMap((entry) => {
    const timeouts = entry.declaration.timeouts
    const timeout = timeouts && { timeout: new Mcp.TimeoutConfig(timeouts) }
    const transport = entry.declaration.transport
    const config =
      transport.type === "remote"
        ? new Mcp.RemoteConfig({ type: "remote", url: transport.url, oauth: false, ...timeout })
        : transport.type === "local" &&
          options.local &&
          new Mcp.LocalConfig({
            type: "local",
            command: transport.command,
            ...(transport.cwd && { cwd: transport.cwd }),
            ...(transport.env && { environment: transport.env }),
            ...timeout,
          })
    if (!config) return []
    return [
      {
        name: entry.slug,
        config,
        within: (timeouts?.startup ?? openCodeTimeout) + (timeouts?.catalog ?? openCodeTimeout),
      },
    ]
  })

const namespace = (name: string) => name.replaceAll(/[^A-Za-z0-9_-]/gu, "_")

const ready = Effect.fn("OpenCodeMcp.ready")(function* (
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

export const make = Effect.fnUntraced(function* (input: {
  readonly context: Pick<Plugin.Context, "mcp" | "tool" | "session">
  readonly boundary: OpenCodeExecution.Boundary
  readonly isSession: boolean
  readonly hasEnvironment: boolean
  readonly apps: Option.Option<AppCatalog.Info>
}) {
  if (!input.isSession) return { apply: () => Effect.void }
  const latest = yield* Ref.make(input.apps)
  const applied = yield* Ref.make(servers(input.apps, { local: input.hasEnvironment }))
  yield* input.context.mcp.transform((editor) => {
    for (const server of Ref.getUnsafe(applied)) editor.set(server.name, server.config)
  })
  const opening = yield* Ref.get(applied)
  if (opening.length)
    yield* input.boundary.offer(ready(input.context, [], opening)).pipe(Effect.forkScoped({ startImmediately: true }))
  if (!input.hasEnvironment)
    yield* input.context.session.hook("context", (event) =>
      Effect.sync(() => {
        const apps = new Set(
          entries(Ref.getUnsafe(latest))
            .filter((entry) => entry.declaration.transport.type === "local")
            .map((entry) => entry.appSlug),
        )
        for (const app of apps)
          event.system.push({
            type: "text",
            text: `The app ${app} needs an execution environment, and this chat has none, so its local tools are not available here.`,
          })
      }),
    )
  return {
    apply: Effect.fnUntraced(function* (apps: Option.Option<AppCatalog.Info>) {
      yield* Ref.set(latest, apps)
      const next = servers(apps, { local: input.hasEnvironment })
      const before = yield* Ref.getAndSet(applied, next)
      if (JSON.stringify(before) === JSON.stringify(next)) return
      yield* input.context.mcp.reload()
      yield* ready(input.context, before, next)
    }),
  }
})
