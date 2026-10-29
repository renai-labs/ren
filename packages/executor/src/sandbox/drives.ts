export * as SandboxDrives from "./drives.js"

import { EnvironmentApi } from "@ren/environment-api/environment-api"
import { Duration, Effect, Exit, Option, Schedule, Schema, Semaphore } from "effect"
import { type ChildProcess, spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, mkdir, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"

const state = join(tmpdir(), "ren-drives")

const unescaped = (field: string) =>
  field.replaceAll(/\\([0-7]{3})/gu, (_escape, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))

const mounts = Effect.promise(() =>
  Bun.file("/proc/mounts")
    .text()
    .catch(() => ""),
).pipe(
  Effect.map((text) =>
    text
      .split("\n")
      .map((line) => line.split(" ").map(unescaped))
      .map((fields) => ({
        source: fields.at(0) ?? "",
        path: fields.at(1) ?? "",
        access: fields.at(3)?.split(",").includes("ro") ? "read" : "write",
      })),
  ),
)

const mountAt = (path: string) =>
  Effect.map(mounts, (all) => Option.fromNullishOr(all.find((mounted) => mounted.path === path)))

const nameOf = (path: string) => Bun.hash(path).toString(36)

const RefreshAnswer = Schema.Struct({ result: Schema.Record(Schema.String, Schema.String) })

// oxlint-disable-next-line ren/no-comments -- rclone refreshes only a folder that it has listed before, and answers "file does not exist" for any other. The deepest folder it knows is refreshed; every folder under it is new to rclone, so rclone lists it from the drive when it is first read.
const refreshed = (socket: string, dir: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch("http://rclone/vfs/refresh", {
        method: "POST",
        unix: socket,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dir ? { dir } : {}),
        signal: AbortSignal.timeout(10_000),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`rclone answered ${response.status}: ${text.slice(0, 300)}`)
      return text
    },
    catch: (cause) => (cause instanceof Error ? cause.message : String(cause)),
  }).pipe(
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(RefreshAnswer))(text).pipe(
        Effect.mapError(() => `rclone answered ${text.slice(0, 300)}`),
      ),
    ),
    Effect.map((answer) => Object.values(answer.result).at(0) ?? ""),
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
    const name = nameOf(path)
    const log = join(state, `${name}.log`)
    const socket = join(state, `${name}.sock`)
    const failed = (message: string) => new EnvironmentApi.MountError({ path: input.path, message })
    const found = yield* mountAt(path)
    if (
      Option.exists(found, (mounted) => mounted.source === source && mounted.access === input.access) &&
      (yield* isServed(source, path))
    )
      return
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
        await mkdir(state, { recursive: true })
        await Bun.write(log, "")
        await rm(socket, { force: true })
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
        ...(input.access === "write"
          ? [
              "--vfs-cache-mode",
              "writes",
              "--cache-dir",
              join(state, `${name}.cache`),
              // oxlint-disable-next-line ren/no-comments -- A file uploads when it is closed. E2B stops a sandbox with no signal, so a file that waits for its upload is lost (measured: a 5 s wait lost a write made 1 s before the stop).
              "--vfs-write-back",
              "0s",
              "--vfs-cache-max-size",
              "1G",
            ]
          : ["--read-only", "--vfs-cache-mode", "minimal"]),
        "--dir-cache-time",
        "10s",
        "--s3-no-check-bucket",
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
        "--rc",
        "--rc-addr",
        `unix://${socket}`,
        "--rc-no-auth",
      ],
      { detached: true, stdio: "ignore" },
    )
    yield* started(child).pipe(Effect.mapError(failed))
    child.unref()
    const mounted = yield* mountAt(path).pipe(
      Effect.map(Option.exists((now) => now.source === source)),
      Effect.flatMap((isMounted) =>
        isMounted || typeof child.exitCode === "number" ? Effect.succeed(isMounted) : Effect.fail("waiting"),
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
  const refresh = Effect.fn("Executor.refresh")(function* (input: EnvironmentApi.RefreshInput) {
    const path = resolve(workspace, input.path)
    const failed = (message: string) => new EnvironmentApi.MountError({ path: input.path, message })
    const drive = (yield* mounts)
      .filter(
        (mounted) =>
          mounted.source.startsWith(":s3:") && (path === mounted.path || path.startsWith(`${mounted.path}/`)),
      )
      .reduce<{ readonly path: string } | undefined>(
        (deepest, mounted) => (deepest && deepest.path.length >= mounted.path.length ? deepest : mounted),
        undefined,
      )
    if (!drive) return yield* failed("it is not on a mounted drive")
    const parts = relative(drive.path, path).split("/").filter(Boolean)
    const socket = join(state, `${nameOf(drive.path)}.sock`)
    for (const dir of [...parts.map((_, index) => parts.slice(0, parts.length - index).join("/")), ""]) {
      const answer = yield* refreshed(socket, dir).pipe(Effect.mapError(failed))
      if (answer === "OK") return
      if (answer !== "file does not exist") return yield* failed(answer)
    }
    return yield* failed("rclone does not know the root of the drive")
  })
  return {
    mount: (input: EnvironmentApi.MountInput) => {
      const path = resolve(workspace, input.path)
      const lock = locks.get(path) ?? Semaphore.makeUnsafe(1)
      locks.set(path, lock)
      return lock.withPermits(1)(mount(path, input))
    },
    refresh,
  }
}
