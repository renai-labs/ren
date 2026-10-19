export * as OverrideShell from "./override-shell.js"

import { Config } from "@opencode/core/config"
import { Location } from "@opencode/core/location"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { DIRECTORY, NotFoundError, Service } from "@opencode/core/shell"
import { ShellSelect } from "@opencode/core/shell/select"
import { MAX_BYTES, MAX_LINES } from "@opencode/core/tool-output"
import { Shell } from "@opencode/schema/shell"
import { CrossSpawnSpawner } from "@opencode/util/cross-spawn-spawner"
import { tags } from "@opencode/util/effect/app-node"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { AppProcess } from "@opencode/util/process"
import { Identifier } from "@ren/schema/identifier"
import { Session } from "@ren/schema/session"
import { Deferred, Duration, Effect, Fiber, Latch, Layer, Option, Stream, Struct } from "effect"
import { ChildProcess } from "effect/process"
import path from "node:path"
import type { EnvironmentFiles } from "@opencode/core/environment/files"
import type { ChildProcessSpawner } from "effect/process"
import type { Hand } from "@ren/brain/hand"

export interface ShellHand {
  readonly spawnerWith: (options: Hand.SpawnOptions) => ChildProcessSpawner.ChildProcessSpawner["Service"]
  readonly overrides: EnvironmentFiles.FilesImpl
}

const exitedLimit = 25

const readEvery = 250

interface Output {
  size: number
  newlines: number
  tail: Uint8Array
}

interface Command {
  info: Shell.Info
  readonly file: string
  readonly output: Output
  readonly done: Deferred.Deferred<Shell.Info, NotFoundError>
  timeout?: ((duration: number) => Effect.Effect<void>) | undefined
  timeoutFiber?: Fiber.Fiber<unknown> | undefined
}

const keepLast = (tail: Uint8Array, chunk: Uint8Array, limit: number) => {
  if (chunk.length >= limit) return chunk.slice(chunk.length - limit)
  const joined = new Uint8Array(Math.min(limit, tail.length + chunk.length))
  const fromTail = joined.length - chunk.length
  joined.set(tail.subarray(tail.length - fromTail), 0)
  joined.set(chunk, fromTail)
  return joined
}

const countNewlines = (chunk: Uint8Array) => chunk.reduce((count, byte) => (byte === 10 ? count + 1 : count), 0)

const layer = (handOf: (sessionId: Session.ID) => ShellHand) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const location = yield* Location.Service
      const global = yield* Global.Service
      const shell = yield* ShellSelect.Service
      const hooks = yield* PluginHooks.Service
      const config = yield* Config.Service
      const runFork = Effect.runForkWith(yield* Effect.context())
      const commands = new Map<Shell.ID, Command>()
      const exitOrder: Array<Shell.ID> = []
      const outputDir = path.join(global.data, DIRECTORY, location.project.id)
      const hand = Option.map(Option.fromNullishOr(location.workspaceID), (workspaceID) =>
        handOf(Session.ID.make(`ses_${Identifier.suffix(workspaceID)}`)),
      )
      const limits = Effect.map(config.entries(), (entries) => {
        const configured = Config.latest(entries, "tool_output")
        return { maxLines: configured?.max_lines ?? MAX_LINES, maxBytes: configured?.max_bytes ?? MAX_BYTES }
      })
      yield* Effect.addFinalizer(() =>
        Effect.gen(function* () {
          for (const command of commands.values()) {
            if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
            yield* Deferred.interrupt(command.done)
          }
          commands.clear()
          exitOrder.length = 0
        }),
      )
      const require = Effect.fnUntraced(function* (id: Shell.ID) {
        const command = commands.get(id)
        if (!command) return yield* new NotFoundError({ id })
        return command
      })
      const removeCommand = Effect.fnUntraced(function* (id: Shell.ID) {
        const command = commands.get(id)
        const index = exitOrder.indexOf(id)
        if (index !== -1) exitOrder.splice(index, 1)
        if (!command) return
        commands.delete(id)
        if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
        yield* Deferred.fail(command.done, new NotFoundError({ id }))
        // oxlint-disable-next-line ren/no-comments -- A frozen hand must not hold up an interrupt, so the file is deleted in the background.
        if (Option.isSome(hand)) runFork(hand.value.overrides.remove(command.file).pipe(Effect.ignore))
      })
      const wait = Effect.fn("Shell.wait")(function* (id: Shell.ID) {
        return yield* Deferred.await((yield* require(id)).done)
      })
      const output = Effect.fnUntraced(function* (id: Shell.ID, input?: Shell.OutputInput) {
        const command = yield* require(id)
        const cursor = input?.cursor ?? 0
        const limit = input?.limit ?? 65536
        if (cursor >= command.output.size)
          return { output: "", cursor: command.output.size, size: command.output.size, truncated: false }
        const start = Math.max(0, cursor)
        const length = Math.min(limit, command.output.size - start)
        const bytes = Option.isSome(hand)
          ? yield* hand.value.overrides.read(command.file, { offset: start, length }).pipe(
              Effect.map((read) => read.bytes),
              Effect.orElseSucceed(() => new Uint8Array()),
            )
          : new Uint8Array()
        return {
          output: new TextDecoder().decode(bytes),
          cursor: start + bytes.length,
          size: command.output.size,
          truncated: false,
        }
      })
      const result = Effect.fn("Shell.result")(function* (started: Shell.Info) {
        const info = yield* wait(started.id).pipe(
          Effect.catchTag("Shell.NotFoundError", () =>
            Effect.succeed(
              Struct.assign(started, {
                status: "killed" as const,
                time: Struct.assign(started.time, { completed: Date.now() }),
              }),
            ),
          ),
        )
        const capture = yield* Effect.gen(function* () {
          const command = yield* require(info.id)
          const limit = yield* limits
          const page = new TextDecoder().decode(
            command.output.tail.subarray(Math.max(0, command.output.tail.length - limit.maxBytes)),
          )
          const lines = page.split("\n")
          if (page.endsWith("\n")) lines.pop()
          const truncated = command.output.size > limit.maxBytes || lines.length > limit.maxLines
          const text = lines.length > limit.maxLines ? lines.slice(-limit.maxLines).join("\n") : page
          const total = command.output.newlines + (page.endsWith("\n") ? 0 : 1)
          const shown = Math.min(lines.length, limit.maxLines)
          const notice = truncated
            ? `\n\n[showing lines ${total - shown + 1}-${total} of ${total}; full output saved to ${info.file}]`
            : ""
          return { output: `${text || "(no output)"}${notice}`, truncated }
        }).pipe(Effect.catchTag("Shell.NotFoundError", () => Effect.succeed(undefined)))
        return { info, capture }
      })
      const create: Service["Service"]["create"] = Effect.fn("Shell.create")(function* (input, before) {
        const invocation = {
          command: input.command,
          cwd: input.cwd ?? location.directory,
          timeout: input.timeout ?? 0,
          shell: input.shell ?? (yield* shell.resolve({ priority: "config" })),
          env: { TERM: "xterm-256color", OPENCODE_TERMINAL: "1" },
        }
        if (Option.isNone(hand))
          return yield* new AppProcess.AppProcessError({
            command: invocation.command,
            cause: new Error("This session has no hand, so it cannot run commands"),
          })
        yield* hooks.trigger("shell", "create.before", invocation)
        if (before) yield* before(invocation)
        const id = Shell.ID.ascending()
        const file = path.join(outputDir, `${id}.out`)
        const info: Shell.Info = {
          id,
          status: "running",
          command: invocation.command,
          cwd: invocation.cwd,
          shell: invocation.shell,
          file,
          metadata: input.metadata ?? {},
          time: { started: Date.now() },
        }
        const keep = (yield* limits).maxBytes
        const ready = Deferred.makeUnsafe<Command, AppProcess.AppProcessError>()
        const output: Output = { size: 0, newlines: 0, tail: new Uint8Array() }
        runFork(
          Effect.scoped(
            Effect.gen(function* () {
              const handle = yield* hand.value
                .spawnerWith({
                  outputFile: file,
                  window: { maxBytes: keep, intervalMs: readEvery },
                  onSkip: (skipped) => {
                    output.size += skipped.bytes
                    output.newlines += skipped.newlines
                    output.tail = new Uint8Array()
                  },
                })
                .spawn(
                  ChildProcess.make(invocation.shell, ShellSelect.args(invocation.shell, invocation.command), {
                    cwd: invocation.cwd,
                    env: invocation.env,
                    stdin: "ignore",
                    detached: true,
                    forceKillAfter: Duration.seconds(3),
                  }),
                )
                .pipe(
                  Effect.mapError((cause) => new AppProcess.AppProcessError({ command: invocation.command, cause })),
                )
              const command: Command = {
                info: Struct.assign(info, { pid: handle.pid }),
                file,
                output,
                done: Deferred.makeUnsafe(),
              }
              commands.set(id, command)
              const outputDone = Latch.makeUnsafe()
              runFork(
                handle.all.pipe(
                  Stream.runForEach((chunk) =>
                    Effect.sync(() => {
                      command.output.size += chunk.length
                      command.output.newlines += countNewlines(chunk)
                      command.output.tail = keepLast(command.output.tail, chunk, keep)
                    }),
                  ),
                  Effect.ignore,
                  Effect.andThen(outputDone.open),
                ),
              )
              const finish = (
                status: Shell.Info["status"],
                exit?: number,
                beforeWait: Effect.Effect<void> = Effect.void,
                signal?: string,
              ) =>
                Effect.gen(function* () {
                  if (command.info.status !== "running") return
                  command.info = Struct.assign(command.info, {
                    status,
                    // ast-grep-ignore: no-nullish-comparison, -- exit code 0 is a value
                    ...(exit !== undefined && { exit }),
                    ...(signal && { signal }),
                    time: Struct.assign(command.info.time, { completed: Date.now() }),
                  })
                  yield* beforeWait
                  yield* outputDone.await
                  yield* Deferred.succeed(command.done, command.info)
                  exitOrder.push(id)
                  while (exitOrder.length > exitedLimit) {
                    const oldest = exitOrder.at(0)
                    if (!oldest) break
                    yield* removeCommand(oldest)
                  }
                  const timeoutFiber = command.timeoutFiber
                  command.timeout = undefined
                  command.timeoutFiber = undefined
                  if (timeoutFiber) yield* Fiber.interrupt(timeoutFiber)
                })
              command.timeout = (duration) =>
                Effect.gen(function* () {
                  if (command.timeoutFiber) yield* Fiber.interrupt(command.timeoutFiber)
                  command.timeoutFiber = undefined
                  if (duration === 0 || command.info.status !== "running") return
                  command.timeoutFiber = runFork(
                    Effect.sleep(Duration.millis(duration)).pipe(
                      Effect.flatMap(() =>
                        finish(
                          "timeout",
                          undefined,
                          handle.kill({ forceKillAfter: Duration.seconds(3) }).pipe(Effect.ignore),
                        ),
                      ),
                    ),
                  )
                })
              yield* command.timeout(invocation.timeout)
              runFork(
                handle.exitCode.pipe(
                  Effect.flatMap((code) => finish("exited", code)),
                  Effect.catch((error) =>
                    finish(
                      "exited",
                      undefined,
                      Effect.void,
                      error.cause instanceof CrossSpawnSpawner.KilledBySignal ? error.cause.signal : undefined,
                    ),
                  ),
                ),
              )
              yield* Deferred.succeed(ready, command)
              yield* Deferred.await(command.done).pipe(Effect.ignore)
            }),
          ).pipe(Effect.catchTag("AppProcessError", (error) => Deferred.fail(ready, error))),
        )
        return (yield* Deferred.await(ready)).info
      })
      return Service.of({
        create,
        list: Effect.fn("Shell.list")(function* () {
          return [...commands.values()]
            .filter((command) => command.info.status === "running")
            .map((command) => command.info)
        }),
        get: Effect.fn("Shell.get")(function* (id) {
          return (yield* require(id)).info
        }),
        wait,
        result,
        timeout: Effect.fn("Shell.timeout")(function* (id, duration) {
          const command = yield* require(id)
          if (command.info.status !== "running" || !command.timeout) return command.info
          yield* command.timeout(duration)
          return command.info
        }),
        output,
        remove: Effect.fn("Shell.remove")(function* (id) {
          yield* require(id)
          yield* removeCommand(id)
        }),
      })
    }),
  )

export const node = (handOf: (sessionId: Session.ID) => ShellHand) =>
  LayerNode.make({
    service: Service,
    tag: tags.values.location,
    layer: layer(handOf),
    deps: [Location.node, Global.node, ShellSelect.node, PluginHooks.node, Config.node],
  })
