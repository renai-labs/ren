export * as LocalSandbox from "./local.js"

import { Brain } from "@ren/schema/brain"
import { Duration, Effect, FiberMap, Layer, Option, Schema, Stream } from "effect"
import { spawn } from "node:child_process"
import { mkdir, readdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { SandboxProvider } from "../sandbox-provider.js"

const loop = (entry: string, log: string) =>
  `while true; do bun ${JSON.stringify(entry)} >>${JSON.stringify(log)} 2>&1; sleep 1; done`

const Binding = Schema.Struct({
  pid: Schema.Int,
  port: Schema.Int,
  handPort: Schema.Int,
  home: Schema.String,
  brainId: Brain.ID,
  generation: Schema.Int,
})
type Binding = typeof Binding.Type

const decodeBinding = Schema.decodeUnknownEffect(Binding)
const BindingFile = Schema.fromJsonString(Binding)

const isAlive = (pid: number) =>
  Effect.sync(() => {
    const result = Effect.runSyncExit(Effect.try(() => process.kill(pid, 0)))
    return result._tag === "Success"
  })

const signal = (pid: number, name: NodeJS.Signals) => Effect.try(() => process.kill(-pid, name)).pipe(Effect.ignore)

const freePort = Effect.callback<number, SandboxProvider.Failed>((resume) => {
  const server = createServer()
  server.once("error", (error) => resume(Effect.fail(new SandboxProvider.Failed({ message: error.message }))))
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    server.close(() => resume(Effect.succeed(port)))
  })
})

const urlOf = (binding: Binding) => `http://127.0.0.1:${binding.port}`

export const layer = (options: {
  readonly entry: string
  readonly executor: string
  readonly root: string
  readonly lostEvery?: Duration.Input
  readonly maxRunning?: number
  readonly template?: string
  readonly owner?: number
}) =>
  Layer.effect(
    SandboxProvider.Service,
    Effect.gen(function* () {
      const timers = yield* FiberMap.make<number>()
      const paused = new Set<number>()
      const failed = (error: unknown) =>
        new SandboxProvider.Failed({ message: error instanceof Error ? error.message : String(error) })
      const read = (binding: Schema.Json) => decodeBinding(binding).pipe(Effect.mapError(failed))
      const homeOf = (brainId: Brain.ID, generation: number) => join(options.root, `${brainId}-${generation}`)
      const bindingFile = (home: string) => join(home, ".ren", "sandbox.json")
      const stored = (home: string) =>
        Effect.promise(() =>
          Bun.file(bindingFile(home))
            .text()
            .catch(() => ""),
        ).pipe(Effect.map((text) => Schema.decodeUnknownOption(BindingFile)(text)))
      const live = (binding: Binding) =>
        Effect.flatMap(isAlive(binding.pid), (alive) =>
          alive
            ? Effect.void
            : Effect.fail(new SandboxProvider.Gone({ message: `Brain process ${binding.pid} is gone` })),
        )

      return SandboxProvider.Service.of({
        kind: "local",
        canEgress: true,
        template: options.template ?? null,
        create: Effect.fn("LocalSandbox.create")(function* (input) {
          const home = homeOf(input.brainId, input.generation)
          const existing = yield* stored(home)
          if (Option.isSome(existing) && (yield* isAlive(existing.value.pid)))
            return { binding: Schema.encodeSync(Binding)(existing.value), url: urlOf(existing.value) }
          if (options.maxRunning) {
            const names = yield* Effect.promise(() => readdir(options.root).catch(() => []))
            const found = yield* Effect.forEach(names, (name) => stored(join(options.root, name)))
            const running = yield* Effect.filter(
              found.flatMap((each) => (Option.isSome(each) ? [each.value] : [])),
              (each) => Effect.map(isAlive(each.pid), (alive) => alive && !paused.has(each.pid)),
            )
            if (running.length >= options.maxRunning)
              return yield* new SandboxProvider.Capacity({
                message: `${running.length} local brains run; the limit is ${options.maxRunning}`,
                retryAfter: Duration.seconds(1),
              })
          }
          yield* Effect.tryPromise({
            try: () =>
              Promise.all([
                mkdir(join(home, ".ren"), { recursive: true }),
                mkdir(join(home, "workspace"), { recursive: true }),
              ]),
            catch: failed,
          })
          const port = yield* freePort
          const handPort = yield* freePort
          const state = join(home, ".ren")
          const ca = Option.flatMap(input.proxy, (proxy) => proxy.ca)
          if (Option.isSome(ca)) yield* Effect.promise(() => Bun.write(join(state, "egress-ca.pem"), ca.value))
          const child = spawn(
            "sh",
            [
              "-c",
              `(export PORT=${handPort}; ${loop(options.executor, join(state, "executor.log"))}) & ${loop(options.entry, join(state, "brain.log"))}`,
            ],
            {
              detached: true,
              stdio: "ignore",
              env: {
                PATH: process.env.PATH,
                HOME: home,
                REN_HOME: home,
                PORT: String(port),
                EXECUTOR_HOST: "127.0.0.1",
                EXECUTOR_WORKSPACE: join(home, "workspace"),
                ...Option.match(input.proxy, {
                  onNone: () => ({}),
                  onSome: (proxy) => SandboxProvider.proxyEnv(proxy, join(state, "egress-ca.pem")),
                }),
                ...input.env,
              },
            },
          )
          child.unref()
          if (!child.pid) return yield* new SandboxProvider.Failed({ message: "The brain process did not start" })
          // oxlint-disable-next-line ren/no-comments -- A brain outlives Ren's process on purpose, but not its owner's (a test run): when the owner is gone, a watcher in its own process group kills the brain's group. SIGKILL also ends a paused (stopped) brain.
          if (options.owner)
            spawn(
              "sh",
              [
                "-c",
                `while kill -0 ${options.owner} 2>/dev/null && kill -0 -- -${child.pid} 2>/dev/null; do sleep 1; done; kill -KILL -- -${child.pid} 2>/dev/null`,
              ],
              { detached: true, stdio: "ignore" },
            ).unref()
          const binding: Binding = {
            pid: child.pid,
            port,
            handPort,
            home,
            brainId: input.brainId,
            generation: input.generation,
          }
          yield* Effect.promise(() => Bun.write(bindingFile(home), Schema.encodeSync(BindingFile)(binding)))
          return { binding: Schema.encodeSync(Binding)(binding), url: urlOf(binding) }
        }),
        connect: Effect.fn("LocalSandbox.connect")(function* (raw) {
          const binding = yield* read(raw)
          yield* live(binding)
          yield* FiberMap.remove(timers, binding.pid)
          yield* signal(binding.pid, "SIGCONT")
          paused.delete(binding.pid)
          return { url: urlOf(binding) }
        }),
        keepAlive: Effect.fn("LocalSandbox.keepAlive")(function* (raw, duration) {
          const binding = yield* read(raw)
          yield* live(binding)
          yield* FiberMap.run(
            timers,
            binding.pid,
            Effect.sleep(duration).pipe(
              Effect.andThen(signal(binding.pid, "SIGSTOP")),
              Effect.andThen(Effect.sync(() => paused.add(binding.pid))),
              Effect.andThen(Effect.logInfo(`Paused local brain ${binding.brainId} (pid ${binding.pid})`)),
            ),
          )
        }),
        destroy: Effect.fn("LocalSandbox.destroy")(function* (raw) {
          const binding = yield* read(raw)
          yield* FiberMap.remove(timers, binding.pid)
          yield* signal(binding.pid, "SIGCONT")
          yield* signal(binding.pid, "SIGKILL")
          paused.delete(binding.pid)
          yield* Effect.promise(() => rm(binding.home, { recursive: true, force: true }))
        }),
        status: Effect.fn("LocalSandbox.status")(function* (raw) {
          const binding = yield* read(raw)
          if (!(yield* isAlive(binding.pid))) return "gone" as const
          return paused.has(binding.pid) ? ("paused" as const) : ("running" as const)
        }),
        hand: Effect.fn("LocalSandbox.hand")(function* (raw) {
          const binding = yield* read(raw)
          return { url: `http://127.0.0.1:${binding.handPort}`, workspace: join(binding.home, "workspace") }
        }),
        lost: Stream.tick(options.lostEvery ?? "2 seconds").pipe(
          Stream.mapEffect(() =>
            Effect.gen(function* () {
              const names = yield* Effect.promise(() => readdir(options.root).catch(() => []))
              const found = yield* Effect.forEach(names, (name) => stored(join(options.root, name)))
              const bindings = found.flatMap((binding) => (Option.isSome(binding) ? [binding.value] : []))
              const dead = yield* Effect.filter(bindings, (binding) =>
                Effect.map(isAlive(binding.pid), (alive) => !alive),
              )
              return dead.map((binding): SandboxProvider.Lost => ({
                brainId: binding.brainId,
                generation: binding.generation,
              }))
            }),
          ),
          Stream.flatMap(Stream.fromIterable),
        ),
        list: Effect.gen(function* () {
          const names = yield* Effect.promise(() => readdir(options.root).catch(() => []))
          const found = yield* Effect.forEach(names, (name) => stored(join(options.root, name)))
          return found.flatMap((binding) =>
            Option.isSome(binding)
              ? [
                  {
                    binding: Schema.encodeSync(Binding)(binding.value),
                    brainId: binding.value.brainId,
                    generation: binding.value.generation,
                  },
                ]
              : [],
          )
        }),
      })
    }),
  )
