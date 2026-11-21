export * as LocalSandbox from "./local.js"

import { ExecutorVariables } from "@ren/hand-api/executor-variables"
import { Workload } from "@ren/schema/workload"
import { DateTime, Duration, Effect, FiberMap, Option, Schema, Stream } from "effect"
import { spawn } from "node:child_process"
import { mkdir, readdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { MachineProvider } from "../machine-provider.js"

// oxlint-disable-next-line ren/no-comments -- Runs the executor and the brain, each again 1 s after it ends. Paths and ports come in as arguments, so the shell quotes nothing.
const supervisor = `loop() { while true; do bun "$1" >>"$2.log" 2>&1 || echo "$?" >"$2.exit"; sleep 1; done; }
(export PORT="$1"; loop "$2" "$3") & loop "$4" "$5"`

// oxlint-disable-next-line ren/no-comments -- Ends the brain's process group once the owner (a test run) is gone. SIGKILL also ends a paused (stopped) brain.
const ownerWatcher = `while kill -0 "$1" 2>/dev/null && kill -0 "-$2" 2>/dev/null; do sleep 1; done; kill -KILL "-$2" 2>/dev/null`

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

// oxlint-disable-next-line ren/no-comments -- A local machine always runs a brain; its hand is the brain's own.
const workloadOf = (binding: Binding) =>
  Schema.decodeUnknownOption(Workload.Info)({ kind: "brain", id: binding.brainId, generation: binding.generation })

// oxlint-disable-next-line ren/no-comments -- What the process is doing, from the system, so it is right after Ren restarts.
const processOf = (pid: number) =>
  Effect.promise(() => Bun.$`ps -o stat= -p ${pid}`.nothrow().quiet().text()).pipe(
    Effect.map((stat) => {
      const code = stat.trim()
      if (code === "" || code.startsWith("Z")) return "gone" as const
      return code.startsWith("T") ? ("stopped" as const) : ("running" as const)
    }),
  )

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
  readonly systemImage?: string
  readonly owner?: number
}) =>
  Effect.gen(function* () {
    const timers = yield* FiberMap.make<number>()
    yield* Effect.promise(() => mkdir(options.root, { recursive: true }))
    const failed = (error: unknown) =>
      new MachineProvider.Failed({ message: error instanceof Error ? error.message : String(error) })
    const homeOf = (brainId: string, generation: number) => join(options.root, `${brainId}-${generation}`)
    const bindingFile = (home: string) => join(home, ".ren", "sandbox.json")
    const stored = Effect.fnUntraced(function* (home: string) {
      const file = Bun.file(bindingFile(home))
      if (!(yield* Effect.promise(() => file.exists()))) return Option.none<Binding>()
      return Schema.decodeUnknownOption(BindingFile)(yield* Effect.promise(() => file.text()))
    })
    // oxlint-disable-next-line ren/no-comments -- Every machine this provider made and has not destroyed, from the binding file in its home.
    const bindings = Effect.promise(() => readdir(options.root)).pipe(
      Effect.flatMap((names) => Effect.forEach(names, (name) => stored(join(options.root, name)))),
      Effect.map((found) => found.flatMap(Option.toArray)),
    )
    const pausedFile = (binding: Binding) => join(binding.home, ".ren", "paused")
    // oxlint-disable-next-line ren/no-comments -- A brain is paused only when this provider stopped it (the paused file says so). One stopped otherwise is frozen: it reports as running and gives no sample, so Ren replaces it.
    const stateOf = Effect.fnUntraced(function* (binding: Binding) {
      const state = yield* processOf(binding.pid)
      if (state !== "stopped") return state
      return (yield* Effect.promise(() => Bun.file(pausedFile(binding)).exists()))
        ? ("paused" as const)
        : ("running" as const)
    })
    const live = (binding: Binding) =>
      Effect.flatMap(processOf(binding.pid), (state) =>
        state === "gone"
          ? Effect.fail(new MachineProvider.Gone({ message: `Brain process ${binding.pid} is gone` }))
          : Effect.void,
      )

    return MachineProvider.make({
      id: MachineProvider.ID.make("local"),
      title: "Local",
      description: "A process on the machine that runs Ren.",
      canEgress: true,
      canMount: false,
      ...(options.systemImage && { systemImage: options.systemImage }),
      config: Schema.Struct({}),
      binding: Binding,
      create: Effect.fn("LocalSandbox.create")(function* (input) {
        const home = homeOf(input.labels.id, input.labels.generation)
        const existing = yield* stored(home)
        if (Option.isSome(existing) && (yield* processOf(existing.value.pid)) !== "gone")
          return { binding: existing.value, url: urlOf(existing.value) }
        if (options.maxRunning) {
          const running = yield* Effect.filter(yield* bindings, (each) =>
            Effect.map(stateOf(each), (state) => state === "running"),
          )
          if (running.length >= options.maxRunning)
            return yield* new MachineProvider.Capacity({
              message: `${running.length} local brains run; the limit is ${options.maxRunning}`,
              retryAfter: Duration.seconds(1),
            })
        }
        const state = join(home, ".ren")
        yield* Effect.tryPromise({
          try: () =>
            Promise.all([mkdir(state, { recursive: true }), mkdir(join(home, "workspace"), { recursive: true })]),
          catch: failed,
        })
        const port = yield* freePort
        const handPort = yield* freePort
        const ca = Option.flatMap(input.network.proxy, (proxy) => proxy.ca)
        if (Option.isSome(ca)) yield* Effect.promise(() => Bun.write(join(state, "egress-ca.pem"), ca.value))
        const own = {
          REN_HOME: home,
          PORT: String(port),
          EXECUTOR_HOST: "127.0.0.1",
          EXECUTOR_WORKSPACE: join(home, "workspace"),
        }
        const child = spawn(
          "sh",
          [
            "-c",
            supervisor,
            "sh",
            String(handPort),
            options.executor,
            join(state, "executor"),
            options.entry,
            join(state, "brain"),
          ],
          {
            detached: true,
            stdio: "ignore",
            env: {
              PATH: process.env.PATH,
              HOME: home,
              ...own,
              ...Option.match(input.network.proxy, {
                onNone: () => ({}),
                onSome: (proxy) => MachineProvider.proxyEnv(proxy, join(state, "egress-ca.pem")),
              }),
              ...input.variables,
              ...ExecutorVariables.hiding([...ExecutorVariables.hiddenIn(input.variables), ...Object.keys(own)]),
            },
          },
        )
        child.unref()
        if (!child.pid) return yield* new MachineProvider.Failed({ message: "The brain process did not start" })
        if (options.owner)
          spawn("sh", ["-c", ownerWatcher, "sh", String(options.owner), String(child.pid)], {
            detached: true,
            stdio: "ignore",
          }).unref()
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
        yield* Effect.promise(() => rm(pausedFile(binding), { force: true }))
        return { url: urlOf(binding) }
      }),
      keepAlive: Effect.fn("LocalSandbox.keepAlive")(function* (binding, duration) {
        yield* live(binding)
        yield* FiberMap.run(
          timers,
          binding.pid,
          Effect.sleep(duration).pipe(
            Effect.andThen(signal(binding.pid, "SIGSTOP")),
            Effect.andThen(Effect.promise(() => Bun.write(pausedFile(binding), ""))),
            Effect.andThen(Effect.logInfo(`Paused local brain ${binding.brainId} (pid ${binding.pid})`)),
            Effect.withErrorReporting,
          ),
        )
      }),
      destroy: Effect.fn("LocalSandbox.destroy")(function* (binding) {
        yield* FiberMap.remove(timers, binding.pid)
        yield* signal(binding.pid, "SIGCONT")
        yield* signal(binding.pid, "SIGKILL")
        yield* Effect.promise(() => rm(binding.home, { recursive: true, force: true }))
      }),
      status: stateOf,
      // oxlint-disable-next-line ren/no-comments -- A running brain's share of the machine's memory, and the use of the disk that holds its home. A stopped or gone one gives no sample, so a frozen brain is replaced.
      lastSample: Effect.fn("LocalSandbox.lastSample")(function* (binding) {
        if ((yield* processOf(binding.pid)) !== "running") return Option.none()
        const memory = Number(
          yield* Effect.promise(() => Bun.$`ps -o %mem= -p ${binding.pid}`.nothrow().quiet().text()),
        )
        const disk = (yield* Effect.promise(() => Bun.$`df -P ${binding.home}`.nothrow().quiet().text()))
          .split("\n")
          .at(1)
          ?.split(/\s+/u)
          .at(4)
        return Option.some({
          at: yield* DateTime.now,
          memory: Number.isFinite(memory) ? memory / 100 : 0,
          disk: disk ? Number(disk.replace("%", "")) / 100 : 0,
        })
      }),
      hand: (binding) => ({
        url: `http://127.0.0.1:${binding.handPort}`,
        workspace: join(binding.home, "workspace"),
      }),
      lost: Stream.tick(options.lostEvery ?? "2 seconds").pipe(
        Stream.mapEffect(() =>
          Effect.flatMap(bindings, (all) =>
            Effect.filter(all, (binding) => Effect.map(processOf(binding.pid), (state) => state === "gone")),
          ),
        ),
        Stream.flatMap((dead) => Stream.fromIterable(dead.flatMap((binding) => Option.toArray(workloadOf(binding))))),
      ),
      list: Effect.map(bindings, (all) =>
        all.flatMap((binding) => Option.toArray(Option.map(workloadOf(binding), (found) => ({ ...found, binding })))),
      ),
    })
  })
