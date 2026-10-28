export * as SandboxDrives from "./drives.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Duration, Effect, Exit, Option, Schedule, Semaphore } from "effect"
import { type ChildProcess, spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const logs = join(tmpdir(), "ren-drives")

const unescaped = (field: string) =>
  field.replaceAll(/\\([0-7]{3})/gu, (_escape, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))

const sourceAt = (path: string) =>
  Effect.promise(() =>
    Bun.file("/proc/mounts")
      .text()
      .catch(() => ""),
  ).pipe(
    Effect.map((text) =>
      Option.fromNullishOr(
        text
          .split("\n")
          .map((line) => line.split(" ").map(unescaped))
          .find((fields) => fields.at(1) === path)
          ?.at(0),
      ),
    ),
  )

const isServed = (source: string, path: string) =>
  Effect.promise(async () => {
    const pids = (await readdir("/proc").catch(() => [])).filter((name) => /^\d+$/u.test(name))
    const commands = await Promise.all(
      pids.map((pid) =>
        Bun.file(`/proc/${pid}/cmdline`)
          .text()
          .catch(() => ""),
      ),
    )
    return commands.some((command) => {
      const args = command.split("\0")
      return args.at(1) === "mount" && args.at(2) === source && args.at(3) === path
    })
  })

const fuseUsable = Effect.promise(() =>
  access("/dev/fuse", constants.R_OK | constants.W_OK).then(
    () => true,
    () => false,
  ),
)

export const canMount = Effect.map(fuseUsable, (usable) => usable && Boolean(Bun.which("rclone")))

const lists = (path: string, seconds: number) =>
  Effect.tryPromise({
    try: () => readdir(path),
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(seconds),
      orElse: () => Effect.fail(`its root did not list within ${seconds} s`),
    }),
  )

const lastError = (log: string) =>
  Effect.promise(() =>
    Bun.file(log)
      .text()
      .catch(() => ""),
  ).pipe(
    Effect.map((text) =>
      Option.fromNullishOr(
        text
          .split("\n")
          .map((line) => /(?:ERROR :|CRITICAL:|Fatal error:)\s*(.*)$/u.exec(line)?.at(1))
          .findLast((found): found is string => Boolean(found)),
      ),
    ),
  )

const started = (child: ChildProcess) =>
  Effect.callback<void, string>((resume) => {
    child.once("spawn", () => resume(Effect.void))
    child.once("error", (error) => resume(Effect.fail(`rclone could not start: ${error.message}`)))
  })

export const make = (workspace: string) => {
  const locks = new Map<string, Semaphore.Semaphore>()
  const mount = Effect.fn("Executor.mount")(function* (path: string, input: EnvironmentApi.MountInput) {
    const remote = input.remote
    const source = `:s3:${remote.bucket}/${remote.prefix}`
    const log = join(logs, `${Bun.hash(path).toString(36)}.log`)
    const failed = (message: string) => new EnvironmentApi.MountError({ path: input.path, message })
    const found = yield* sourceAt(path)
    if (Option.contains(found, source) && (yield* isServed(source, path))) return
    if (Option.isSome(found))
      yield* Effect.promise(
        () =>
          new Promise((done) =>
            spawn("fusermount3", ["-uz", path], { stdio: "ignore" }).once("close", done).once("error", done),
          ),
      )
    if (!(yield* fuseUsable)) return yield* failed("this environment has no usable /dev/fuse")
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(path, { recursive: true })
        await mkdir(logs, { recursive: true })
        await Bun.write(log, "")
      },
      catch: (cause) => failed(cause instanceof Error ? cause.message : String(cause)),
    })
    const child = spawn(
      "rclone",
      [
        "mount",
        source,
        path,
        "--devname",
        source,
        "--read-only",
        "--vfs-cache-mode",
        "minimal",
        "--dir-cache-time",
        "10s",
        "--s3-provider",
        remote.endpoint ? "Minio" : "AWS",
        "--s3-region",
        remote.region,
        ...(remote.endpoint ? ["--s3-endpoint", remote.endpoint, "--s3-force-path-style"] : []),
        "--s3-access-key-id",
        remote.placeholder,
        "--s3-secret-access-key",
        remote.placeholder,
        "--log-file",
        log,
      ],
      { detached: true, stdio: "ignore" },
    )
    yield* started(child).pipe(Effect.mapError(failed))
    child.unref()
    const mounted = yield* sourceAt(path).pipe(
      Effect.flatMap((now) =>
        Option.contains(now, source) || typeof child.exitCode === "number"
          ? Effect.succeed(Option.contains(now, source))
          : Effect.fail("waiting"),
      ),
      Effect.retry({ schedule: Schedule.spaced("100 millis"), times: 100 }),
      Effect.orElseSucceed(() => false),
    )
    if (!mounted)
      return yield* failed(
        Option.getOrElse(yield* lastError(log), () =>
          typeof child.exitCode !== "number"
            ? "rclone did not mount within 10 s"
            : `rclone exited with ${child.exitCode}`,
        ),
      )
    const listed = yield* Effect.exit(lists(path, 20))
    if (Exit.isFailure(listed))
      return yield* failed(
        Option.getOrElse(yield* lastError(log), () =>
          Option.getOrElse(Exit.findErrorOption(listed), () => "its root did not list"),
        ),
      )
  })
  return (input: EnvironmentApi.MountInput) => {
    const path = resolve(workspace, input.path)
    const lock = locks.get(path) ?? Semaphore.makeUnsafe(1)
    locks.set(path, lock)
    return lock.withPermits(1)(mount(path, input))
  }
}
