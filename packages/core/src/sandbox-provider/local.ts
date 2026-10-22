export * as LocalSandbox from "./local.js"

import { Brain } from "@ren/schema/brain"
import { Effect, FiberMap, Layer, Option, Schema } from "effect"
import { spawn } from "node:child_process"
import { closeSync, openSync } from "node:fs"
import { mkdir, readdir, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { SandboxProvider } from "../sandbox-provider.js"

const Binding = Schema.Struct({
  pid: Schema.Int,
  port: Schema.Int,
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

export const layer = (options: { readonly entry: string; readonly root: string }) =>
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
        create: Effect.fn("LocalSandbox.create")(function* (input) {
          const home = homeOf(input.brainId, input.generation)
          const existing = yield* stored(home)
          if (Option.isSome(existing) && (yield* isAlive(existing.value.pid)))
            return { binding: Schema.encodeSync(Binding)(existing.value), url: urlOf(existing.value) }
          yield* Effect.tryPromise({
            try: () => mkdir(join(home, ".ren"), { recursive: true }),
            catch: failed,
          })
          const port = yield* freePort
          const log = openSync(join(home, ".ren", "brain.log"), "a")
          const child = spawn("sh", ["-c", `while true; do bun ${JSON.stringify(options.entry)}; sleep 1; done`], {
            detached: true,
            stdio: ["ignore", log, log],
            env: {
              PATH: process.env.PATH,
              HOME: home,
              REN_HOME: home,
              PORT: String(port),
              ...input.env,
            },
          })
          closeSync(log)
          child.unref()
          if (!child.pid) return yield* new SandboxProvider.Failed({ message: "The brain process did not start" })
          const binding: Binding = { pid: child.pid, port, home, brainId: input.brainId, generation: input.generation }
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
