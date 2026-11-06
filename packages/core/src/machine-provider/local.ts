export * as LocalSandbox from "./local.js"

import { DateTime, Duration, Effect, FiberMap, Option, Schema, Stream } from "effect"
import { spawn } from "node:child_process"
import { mkdir, readdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { EnvironmentProvider } from "../environment-provider.js"
import { MachineProvider } from "../machine-provider.js"

const loop = (entry: string, file: string) =>
  `while true; do bun ${JSON.stringify(entry)} >>${JSON.stringify(`${file}.log`)} 2>&1 || echo "$?" >${JSON.stringify(`${file}.exit`)}; sleep 1; done`

const Binding = Schema.Struct({
  pid: Schema.Int,
  port: Schema.Int,
  handPort: Schema.Int,
  home: Schema.String,
  brainId: Schema.String,
  generation: Schema.Int,
})
type Binding = typeof Binding.Type

const BindingFile = Schema.fromJsonString(Binding)

const isAlive = (pid: number) =>
  Effect.sync(() => {
    const result = Effect.runSyncExit(Effect.try(() => process.kill(pid, 0)))
    return result._tag === "Success"
  })

const signal = (pid: number, name: NodeJS.Signals) => Effect.try(() => process.kill(-pid, name)).pipe(Effect.ignore)

const freePort = Effect.callback<number, MachineProvider.Failed>((resume) => {
  const server = createServer()
  server.once("error", (error) => resume(Effect.fail(new MachineProvider.Failed({ message: error.message }))))
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    server.close(() => resume(Effect.succeed(port)))
  })
})

const urlOf = (binding: Binding) => `http://127.0.0.1:${binding.port}`

export const provider = (options: {
  readonly entry: string
  readonly executor: string
  readonly root: string
  readonly lostEvery?: Duration.Input
  readonly maxRunning?: number
  readonly template?: string
  readonly owner?: number
}) =>
  Effect.gen(function* () {
    const timers = yield* FiberMap.make<number>()
    const paused = new Set<number>()
    const failed = (error: unknown) =>
      new MachineProvider.Failed({ message: error instanceof Error ? error.message : String(error) })
    const homeOf = (brainId: string, generation: number) => join(options.root, `${brainId}-${generation}`)
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
          : Effect.fail(new MachineProvider.Gone({ message: `Brain process ${binding.pid} is gone` })),
      )

    return MachineProvider.make({
      id: EnvironmentProvider.ID.make("local"),
      title: "Local",
      description: "A process on the machine that runs Ren.",
      canEgress: true,
      canMount: false,
      canSample: true,
      canColocate: true,
      canLimitHosts: false,
      ...(options.template && { template: options.template }),
      config: Schema.Struct({}),
      binding: Binding,
      create: Effect.fn("LocalSandbox.create")(function* (input) {
        const home = homeOf(input.labels.id, input.labels.generation)
        const existing = yield* stored(home)
        if (Option.isSome(existing) && (yield* isAlive(existing.value.pid)))
          return { binding: existing.value, url: urlOf(existing.value) }
        if (options.maxRunning) {
          const names = yield* Effect.promise(() => readdir(options.root).catch(() => []))
          const found = yield* Effect.forEach(names, (name) => stored(join(options.root, name)))
          const running = yield* Effect.filter(
            found.flatMap((each) => (Option.isSome(each) ? [each.value] : [])),
            (each) => Effect.map(isAlive(each.pid), (alive) => alive && !paused.has(each.pid)),
          )
          if (running.length >= options.maxRunning)
            return yield* new MachineProvider.Capacity({
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
            `(export PORT=${handPort}; ${loop(options.executor, join(state, "executor"))}) & ${loop(options.entry, join(state, "brain"))}`,
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
                onSome: (proxy) => MachineProvider.proxyEnv(proxy, join(state, "egress-ca.pem")),
              }),
              ...input.variables,
            },
          },
        )
        child.unref()
        if (!child.pid) return yield* new MachineProvider.Failed({ message: "The brain process did not start" })
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
          brainId: input.labels.id,
          generation: input.labels.generation,
        }
        yield* Effect.promise(() => Bun.write(bindingFile(home), Schema.encodeSync(BindingFile)(binding)))
        return { binding, url: urlOf(binding) }
      }),
      connect: Effect.fn("LocalSandbox.connect")(function* (binding) {
        yield* live(binding)
        yield* FiberMap.remove(timers, binding.pid)
        yield* signal(binding.pid, "SIGCONT")
        paused.delete(binding.pid)
        return { url: urlOf(binding) }
      }),
      keepAlive: Effect.fn("LocalSandbox.keepAlive")(function* (binding, duration) {
        yield* live(binding)
        yield* FiberMap.run(
          timers,
          binding.pid,
          Effect.sleep(duration).pipe(
            Effect.andThen(signal(binding.pid, "SIGSTOP")),
            Effect.andThen(Effect.sync(() => paused.add(binding.pid))),
            Effect.andThen(Effect.logInfo(`Paused local brain ${binding.brainId} (pid ${binding.pid})`)),
            Effect.withErrorReporting,
          ),
        )
      }),
      destroy: Effect.fn("LocalSandbox.destroy")(function* (binding) {
        yield* FiberMap.remove(timers, binding.pid)
        yield* signal(binding.pid, "SIGCONT")
        yield* signal(binding.pid, "SIGKILL")
        paused.delete(binding.pid)
        yield* Effect.promise(() => rm(binding.home, { recursive: true, force: true }))
      }),
      status: Effect.fn("LocalSandbox.status")(function* (binding) {
        if (!(yield* isAlive(binding.pid))) return "gone" as const
        return paused.has(binding.pid) ? ("paused" as const) : ("running" as const)
      }),
      lastSample: Effect.fn("LocalSandbox.lastSample")(function* (binding) {
        const state = new TextDecoder()
          .decode(Bun.spawnSync(["ps", "-o", "stat=", "-p", String(binding.pid)]).stdout)
          .trim()
        if (state === "" || state.startsWith("T")) return Option.none()
        return Option.some({ at: yield* DateTime.now, memory: 0, disk: 0 })
      }),
      hand: (binding) => ({
        url: `http://127.0.0.1:${binding.handPort}`,
        workspace: join(binding.home, "workspace"),
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
            return dead.map((binding): MachineProvider.Lost => ({
              id: binding.brainId,
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
            ? [{ binding: binding.value, id: binding.value.brainId, generation: binding.value.generation }]
            : [],
        )
      }),
    })
  })
