export * as OpenCodeMcp from "./mcp.js"

import type { Plugin } from "@opencode/plugin/effect"
import { Mcp } from "@opencode/schema/mcp"
import { BrainToken } from "@ren/host-api/brain-token"
import { HostMcp } from "@ren/host-api/host-mcp"
import type { AppCatalog } from "@ren/schema/app-catalog"
import type { Channel } from "@ren/schema/channel"
import { Credential } from "@ren/schema/credential"
import { Clock, Duration, Effect, FiberHandle, Option, Ref, Schedule, Semaphore } from "effect"
import { HostToken } from "../../host-token.js"
import { OpenCodeChat } from "./chat.js"
import type { OpenCodeExecution } from "./execution.js"

export const renServer = "ren"

export interface RenAccess {
  readonly address: Effect.Effect<Option.Option<string>>
  readonly token: Effect.Effect<Option.Option<string>>
}

export interface Ren extends RenAccess {
  readonly lastSender: (sessionId: string) => Effect.Effect<Option.Option<string>>
}

// oxlint-disable-next-line ren/no-comments -- OpenCode 2.0.27 waits 30 seconds for each of startup and tools/list when a server declares no timeout.
const openCodeTimeout = 30_000

// oxlint-disable-next-line ren/no-comments -- OpenCode publishes a connected server's tools about 100 ms after it connects, and sends no event when it does.
const published = "1 second"

const checks = Schedule.spaced("25 millis")

// oxlint-disable-next-line ren/no-comments -- profiles.md §6.4 rule 7 (P47): after a failure, Ren connects its failed servers again 10 s, 1 min and 5 min later.
const retryDelays: ReadonlyArray<Duration.Input> = ["10 seconds", "1 minute", "5 minutes"]

interface Server {
  readonly name: string
  readonly config: Mcp.RemoteConfig | Mcp.LocalConfig
  readonly within: number
}

const catalogOf = (apps: Option.Option<AppCatalog.Info>) => Option.map(apps, (info) => info.catalog)

const entries = (apps: Option.Option<AppCatalog.Info>): ReadonlyArray<AppCatalog.McpEntry> =>
  Option.match(catalogOf(apps), { onNone: () => [], onSome: (catalog) => catalog.mcps })

// oxlint-disable-next-line ren/no-comments -- §6.4 rule 3: a sign-in sends its token as a Bearer placeholder, a header MCP its pasted field in the declared header. A basic credential needs no placeholder: the egress sets its header by host.
const headersOf = (entry: AppCatalog.McpEntry): Readonly<Record<string, string>> | undefined => {
  const auth = entry.declaration.auth
  if (!entry.label) return undefined
  if (auth.type === "oauth") return { Authorization: `Bearer ${Credential.placeholder(entry.label)}` }
  if (auth.type === "header") return { [auth.name]: Credential.placeholder(entry.label, auth.credential) }
  return undefined
}

const configOf = (
  entry: AppCatalog.McpEntry,
  options: { readonly local: boolean },
): Option.Option<Mcp.RemoteConfig | Mcp.LocalConfig> => {
  const timeouts = entry.declaration.timeouts
  const timeout = timeouts && { timeout: new Mcp.TimeoutConfig(timeouts) }
  const transport = entry.declaration.transport
  if (transport.type === "local") {
    if (!options.local) return Option.none()
    const environment = { ...transport.env, ...entry.env }
    return Option.some(
      new Mcp.LocalConfig({
        type: "local",
        command: transport.command,
        ...(transport.cwd && { cwd: transport.cwd }),
        ...(Object.keys(environment).length > 0 && { environment }),
        ...timeout,
      }),
    )
  }
  const url = transport.type === "remote" ? transport.url : entry.url
  if (!url) return Option.none()
  const headers = headersOf(entry)
  return Option.some(
    new Mcp.RemoteConfig({ type: "remote", url, oauth: false, ...(headers && { headers }), ...timeout }),
  )
}

export const servers = (
  apps: Option.Option<AppCatalog.Info>,
  options: { readonly local: boolean },
): ReadonlyArray<Server> =>
  entries(apps).flatMap((entry) => {
    const config = configOf(entry, options)
    const timeouts = entry.declaration.timeouts
    return Option.isSome(config)
      ? [
          {
            name: entry.server,
            config: config.value,
            within: (timeouts?.startup ?? openCodeTimeout) + (timeouts?.catalog ?? openCodeTimeout),
          },
        ]
      : []
  })

const namespace = (name: string) => name.replaceAll(/[^A-Za-z0-9_-]/gu, "_")

// oxlint-disable-next-line ren/no-comments -- HR20: the profile of a server goes into the description of its tool namespace; OpenCode sends a change of the tool catalog as a short message, so the system prompt and its cache stay.
const namespaces = (apps: Option.Option<AppCatalog.Info>, options: { readonly local: boolean }) =>
  entries(apps).flatMap((entry) =>
    entry.profile && (options.local || entry.declaration.transport.type !== "local")
      ? [
          {
            name: namespace(entry.server),
            description: `${entry.declaration.name} for the profile “${entry.profile.name}”`,
          },
        ]
      : [],
  )

// oxlint-disable-next-line ren/no-comments -- §6.4 rule 9 (P47): the env keys of each app's profiles, from the catalog only and in its order, so one catalog gives the same bytes (INV-34).
export const notes = (apps: Option.Option<AppCatalog.Info>) =>
  Option.match(catalogOf(apps), {
    onNone: () => [],
    onSome: (catalog) =>
      catalog.apps.flatMap((app) => {
        const profiles = app.profiles.flatMap((profile) => {
          const first = Object.keys(profile.env).at(0)
          const example = first && profile.env[first]
          if (!first || !example) return []
          return [{ name: profile.name, suffix: example.slice(first.length), example }]
        })
        return profiles.length
          ? [
              `${app.appSlug} profiles: ${profiles
                .map((profile, index) =>
                  index === 0
                    ? `${profile.name} → keys end in \`${profile.suffix}\` (\`${profile.example}\`)`
                    : `${profile.name} → \`${profile.suffix}\``,
                )
                .join("; ")}. Env keys exist only with the suffix.`,
            ]
          : []
      }),
  })

const isDown = (status: string) => status === "failed" || status === "needs_auth"

// oxlint-disable-next-line ren/no-comments -- §6.4 rule 7: each delay, if a server is still down, connect it again; the loop stops once none is down.
export const retrying = (input: { readonly down: Effect.Effect<boolean>; readonly retry: Effect.Effect<void> }) =>
  Effect.forEach(
    retryDelays,
    (delay) =>
      Effect.sleep(delay).pipe(
        Effect.andThen(input.down),
        Effect.flatMap((down) => (down ? input.retry.pipe(Effect.as(true)) : Effect.succeed(false))),
      ),
    { discard: true },
  ).pipe(Effect.asVoid)

export const make = Effect.fnUntraced(function* (input: {
  readonly context: Pick<Plugin.Context, "mcp" | "tool" | "session">
  readonly boundary: OpenCodeExecution.Boundary
  readonly isSession: boolean
  readonly hasEnvironment: boolean
  readonly apps: Option.Option<AppCatalog.Info>
  readonly channels: ReadonlyArray<Channel.Provider>
  readonly sessionId: string
  readonly ren: Option.Option<Ren>
}) {
  if (!input.isSession) return { apply: () => Effect.void, reloading: Effect.succeed(false) }
  const local = { local: input.hasEnvironment }
  const latest = yield* Ref.make(input.apps)
  const channels = yield* Ref.make(input.channels)
  const sender = yield* Ref.make(Option.none<string>())
  const presented = yield* Ref.make(Option.none<string>())
  const tokenOf = (ren: Ren) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const kept = Option.filter(yield* Ref.get(presented), (token) =>
        Option.exists(BrainToken.expiry(token), (exp) => exp * 1000 - now > Duration.toMillis(HostToken.refreshBefore)),
      )
      const token = Option.isSome(kept) ? kept : yield* ren.token
      yield* Ref.set(presented, token)
      return token
    })
  const renServers = Effect.gen(function* () {
    if (Option.isNone(input.ren)) return []
    const address = yield* input.ren.value.address
    const token = yield* tokenOf(input.ren.value)
    if (Option.isNone(address) || Option.isNone(token)) return []
    const user = yield* Ref.get(sender)
    const headers = {
      Authorization: `Bearer ${token.value}`,
      [HostMcp.sessionHeader]: input.sessionId,
    }
    const base = address.value.replace(/\/$/u, "")
    return [
      {
        name: renServer,
        config: new Mcp.RemoteConfig({
          type: "remote",
          url: `${base}${HostMcp.path}`,
          oauth: false,
          headers: { ...headers, ...(Option.isSome(user) && { [HostMcp.userHeader]: user.value }) },
        }),
        within: 2 * openCodeTimeout,
      },
      ...(yield* Ref.get(channels)).map((provider) => ({
        name: provider,
        config: new Mcp.RemoteConfig({
          type: "remote",
          url: `${base}${HostMcp.channelPath(provider)}`,
          oauth: false,
          headers,
        }),
        within: 2 * openCodeTimeout,
      })),
    ]
  })
  const desired = (apps: Option.Option<AppCatalog.Info>) =>
    Effect.map(renServers, (ren): ReadonlyArray<Server> => [...servers(apps, local), ...ren])
  const applied = yield* Ref.make(yield* desired(input.apps))
  const skipped = yield* Ref.make<ReadonlySet<string>>(new Set())
  const retries = yield* FiberHandle.make<void>()
  const pending = yield* Ref.make(0)
  const reloads = yield* Semaphore.make(1)
  const scope = yield* Effect.scope
  yield* input.context.mcp.transform((editor) => {
    const skip = Ref.getUnsafe(skipped)
    for (const server of Ref.getUnsafe(applied)) if (!skip.has(server.name)) editor.set(server.name, server.config)
  })
  yield* input.context.tool.transform((editor) => {
    for (const each of namespaces(Ref.getUnsafe(latest), local)) editor.namespace(each)
  })
  const statuses = input.context.mcp.list().pipe(
    Effect.orDie,
    Effect.map((listed) => new Map(listed.data.map((server) => [server.name, server.status.status]))),
  )
  const down = Effect.map(statuses, (all) =>
    Ref.getUnsafe(applied)
      .map((server) => server.name)
      .filter((name) => isDown(all.get(name) ?? "pending")),
  )

  // oxlint-disable-next-line ren/no-comments -- Until the catalog's servers connect or time out and OpenCode's tool list has their tools and not the removed ones. HR19: only the first turn waits for it; after a change it runs in the background.
  const ready = Effect.fnUntraced(function* (before: ReadonlyArray<Server>, only?: ReadonlyArray<string>) {
    const after = Ref.getUnsafe(applied).filter((server) => !only || only.includes(server.name))
    const connecting = yield* statuses.pipe(
      Effect.map((all) => after.filter((server) => (all.get(server.name) ?? "pending") === "pending")),
      Effect.repeat({ schedule: checks, until: (pending) => pending.length === 0 }),
      Effect.timeoutOption(Math.max(0, ...after.map((server) => server.within))),
    )
    if (Option.isNone(connecting))
      yield* Effect.logWarning(
        `MCP servers did not finish connecting in time: ${after.map((server) => server.name).join(", ")}`,
      )
    const all = yield* statuses
    const connected = after
      .filter((server) => all.get(server.name) === "connected")
      .map((server) => namespace(server.name))
    const names = new Set(Ref.getUnsafe(applied).map((server) => server.name))
    const removed = before
      .filter((server) => !names.has(server.name) && (!only || only.includes(server.name)))
      .map((server) => namespace(server.name))
    yield* input.context.tool.list().pipe(
      Effect.map(
        (tools) => new Set(tools.flatMap((tool) => (tool.options?.namespace ? [tool.options.namespace] : []))),
      ),
      Effect.repeat({
        schedule: checks,
        until: (listed) => connected.every((each) => listed.has(each)) && !removed.some((each) => listed.has(each)),
      }),
      Effect.timeoutOption(published),
    )
  })

  // oxlint-disable-next-line ren/no-comments -- OpenCode reconnects a server only when its config changes (2.0.27 `reconcile`), so a reconnect takes the down servers out and puts them back; servers that work are not touched. A reload returns after its servers connect or fail.
  const reconnect = reloads.withPermit(
    Effect.gen(function* () {
      const failed = yield* down
      if (!failed.length) return
      yield* Ref.set(skipped, new Set(failed))
      yield* input.context.mcp.reload()
      yield* Ref.set(skipped, new Set())
      yield* input.context.mcp.reload()
    }),
  )

  // oxlint-disable-next-line ren/no-comments -- One timed retry runs at a time; a reconnect from a prompt meanwhile waits for it, then finds nothing down.
  const watch = FiberHandle.run(
    retries,
    retrying({ down: Effect.map(down, (failed) => failed.length > 0), retry: reconnect }),
    {
      onlyIfMissing: true,
    },
  ).pipe(Effect.asVoid)

  const watchIfDown = Effect.flatMap(down, (failed) => (failed.length ? watch : Effect.void))

  const retry = reconnect.pipe(
    Effect.andThen(Effect.suspend(() => ready(Ref.getUnsafe(applied)))),
    Effect.andThen(watchIfDown),
  )

  const changed = Effect.gen(function* () {
    const next = yield* desired(Ref.getUnsafe(latest))
    const before = yield* Ref.getAndSet(applied, next)
    return JSON.stringify(before) === JSON.stringify(next) ? Option.none<ReadonlyArray<Server>>() : Option.some(before)
  })

  const reload = (before: ReadonlyArray<Server>, only?: ReadonlyArray<string>) =>
    reloads.withPermit(input.context.mcp.reload()).pipe(Effect.andThen(ready(before, only)))

  if ((yield* Ref.get(applied)).length) {
    yield* Ref.update(pending, (count) => count + 1)
    yield* input.boundary
      .holdUntil(
        ready([]).pipe(Effect.andThen(watchIfDown), Effect.ensuring(Ref.update(pending, (count) => count - 1))),
      )
      .pipe(Effect.forkScoped({ startImmediately: true }))
  }
  // oxlint-disable-next-line ren/no-comments -- A turn calls Ren MCP as its sender: when the sender changes, the prompt waits for the ren server's new headers, so no step runs as the previous sender. Other changes reload in the background (HR19).
  yield* input.context.session.hook("prompt", (event) =>
    Effect.gen(function* () {
      if (Option.isSome(input.ren)) {
        const named = Option.map(OpenCodeChat.speakerOf(event.metadata), (speaker) => speaker.userID)
        if (Option.isSome(named)) yield* Ref.set(sender, named)
        else if (Option.isNone(yield* Ref.get(sender)))
          yield* Ref.set(sender, yield* input.ren.value.lastSender(input.sessionId))
        const before = yield* changed
        if (Option.isSome(before)) yield* reload(before.value, [renServer]).pipe(Effect.andThen(watchIfDown))
      }
      if ((yield* down).length) yield* retry
    }),
  )
  yield* input.context.session.hook("context", (event) =>
    Effect.sync(() => {
      for (const text of notes(Ref.getUnsafe(latest))) event.system.push({ type: "text", text })
    }),
  )
  return {
    // oxlint-disable-next-line ren/no-comments -- HR1, HR19: a catalog change reloads OpenCode's servers in the background, so the caller (a pull) never waits for a server. A running call on a changed or removed server ends.
    apply: Effect.fnUntraced(function* (
      apps: Option.Option<AppCatalog.Info>,
      providers: ReadonlyArray<Channel.Provider>,
    ) {
      yield* Ref.set(latest, apps)
      yield* Ref.set(channels, providers)
      const before = yield* changed
      if (Option.isNone(before)) return
      yield* Ref.update(pending, (count) => count + 1)
      yield* reload(before.value).pipe(
        Effect.andThen(watchIfDown),
        Effect.ensuring(Ref.update(pending, (count) => count - 1)),
        Effect.forkIn(scope),
      )
    }),
    reloading: Effect.map(Ref.get(pending), (count) => count > 0),
  }
})
