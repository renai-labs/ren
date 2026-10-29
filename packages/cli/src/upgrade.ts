export * as Upgrade from "./upgrade.js"

import { Clock, Effect, FileSystem, Option, Schema } from "effect"
import type { Command } from "effect/cli"
import { HttpClient } from "effect/http"
import { dirname, join } from "node:path"
import type { Commands } from "./commands.js"
import { Directories } from "./directories.js"
import { Release } from "./release.js"
import { Output } from "./services/output.js"

const Version = Schema.String.check(
  Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u),
)

const Cache = Schema.fromJsonString(Schema.Struct({ checkedAt: Schema.Number, version: Schema.NullOr(Version) }))

const Upgraded = Schema.Struct({ from: Schema.String, to: Schema.String, upgraded: Schema.Boolean })

const hour = 60 * 60 * 1000

const day = 24 * hour

const core = (version: string) => (version.split("-").at(0) ?? "").split(".").map((part) => Number.parseInt(part, 10))

const prerelease = (version: string) => version.split("-").slice(1).join("-")

const isNewer = (candidate: string, current: string) => {
  const other = core(current)
  const difference = core(candidate)
    .map((part, index) => part - (other.at(index) ?? 0))
    .find((each) => each !== 0)
  if (difference) return difference > 0
  const left = prerelease(candidate)
  const right = prerelease(current)
  if (left === right) return false
  if (!left) return true
  return right ? left > right : false
}

const host = () => (process.env.REN2_HOST_URL ?? Release.host).replace(/\/$/u, "")

const latest = Effect.fn("Upgrade.latest")(function* (origin: string) {
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  const text = yield* http.get(`${origin}/ren2/latest.txt`).pipe(Effect.flatMap((response) => response.text))
  return yield* Schema.decodeUnknownEffect(Version)(text.trim())
})

const minimum = Effect.fn("Upgrade.minimum")(function* (origin: string) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.get(`${origin}/ren2/minimum.txt`)
  if (response.status === 403 || response.status === 404) return null
  if (response.status !== 200) return yield* Effect.fail(new Error(`minimum.txt answered ${response.status}`))
  return yield* Schema.decodeUnknownEffect(Version)((yield* response.text).trim())
})

const remembered = Effect.fn("Upgrade.remembered")(function* <E, R>(
  options: { readonly cache: string; readonly within: number },
  load: Effect.Effect<string | null, E, R>,
) {
  const fs = yield* FileSystem.FileSystem
  const now = yield* Clock.currentTimeMillis
  const cached = yield* fs
    .readFileString(options.cache)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Cache)), Effect.option)
  const fresh = Option.filter(cached, (cache) => now - cache.checkedAt < options.within)
  if (Option.isSome(fresh)) return fresh.value.version
  const version = yield* load
  yield* fs.makeDirectory(dirname(options.cache), { recursive: true })
  yield* fs.writeFileString(options.cache, yield* Schema.encodeEffect(Cache)({ checkedAt: now, version }))
  return version
})

export const run = Effect.fn("Upgrade.run")(function* (
  input: Command.Command.Config.Infer<typeof Commands.upgradeOptions>,
) {
  const output = yield* Output.Service
  const fs = yield* FileSystem.FileSystem
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  if (!Release.compiled)
    return yield* new Output.Failure({ message: "This ren2 runs from source. Pull and rebuild it to update." })
  const origin = host()
  const pinned = Option.map(input.version, (version) => version.replace(/^v/u, ""))
  const wanted = Option.isSome(pinned)
    ? yield* Schema.decodeUnknownEffect(Version)(pinned.value).pipe(
        Effect.mapError(() => new Output.Failure({ message: `Invalid version: ${pinned.value}` })),
      )
    : yield* latest(origin).pipe(
        Effect.mapError(() => new Output.Failure({ message: "Couldn’t find the latest release." })),
      )
  const current = Release.version
  if (wanted === current || (Option.isNone(pinned) && !isNewer(wanted, current)))
    return yield* output.result(
      Upgraded,
      { from: current, to: current, upgraded: false },
      `ren2 v${current} is up to date.`,
    )
  const asset = `ren2-${process.platform}-${process.arch}`
  const url = `${origin}/ren2/releases/${wanted}/${asset}`
  const unavailable = () => new Output.Failure({ message: `Couldn’t download ren2 v${wanted}.` })
  yield* output.progress(`Downloading ren2 v${wanted}…`)
  const bytes = new Uint8Array(
    yield* http.get(url).pipe(
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.mapError(unavailable),
    ),
  )
  const checksum = yield* http.get(`${url}.sha256`).pipe(
    Effect.flatMap((response) => response.text),
    Effect.mapError(unavailable),
  )
  if (checksum.trim() !== `${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}  ${asset}`)
    return yield* new Output.Failure({ message: "Checksum mismatch." })
  const executable = yield* fs.realPath(process.execPath)
  const temporary = `${executable}.upgrade-${process.pid}`
  yield* Effect.gen(function* () {
    yield* fs.writeFile(temporary, bytes)
    yield* fs.chmod(temporary, 0o755)
    const reported = yield* Effect.tryPromise({
      try: () =>
        new Response(
          Bun.spawn([temporary, "--version"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" }).stdout,
        ).text(),
      catch: () => new Output.Failure({ message: "The downloaded ren2 could not start." }),
    })
    if (reported.trim() !== `ren2 v${wanted}`)
      return yield* new Output.Failure({ message: "The downloaded ren2 reports the wrong version." })
    yield* fs.rename(temporary, executable)
  }).pipe(Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)))
  yield* output.result(
    Upgraded,
    { from: current, to: wanted, upgraded: true },
    `Upgraded ren2 v${current} → v${wanted}.`,
  )
})

export const available = Effect.fn("Upgrade.available")(function* (options: {
  readonly host: string
  readonly cache: string
  readonly current: string
}) {
  const found = yield* remembered({ cache: options.cache, within: day }, latest(options.host))
  return found && isNewer(found, options.current) ? Option.some(found) : Option.none()
})

export const required = Effect.fn("Upgrade.required")(function* (options: {
  readonly host: string
  readonly cache: string
  readonly current: string
}) {
  const found = yield* remembered({ cache: options.cache, within: hour }, minimum(options.host))
  return found && isNewer(found, options.current) ? Option.some(found) : Option.none()
})

export const gate = Effect.gen(function* () {
  if (!Release.compiled || process.env.REN2_NO_UPDATE_CHECK) return
  const needed = yield* required({
    host: host(),
    cache: join(Directories.config(), "minimum.json"),
    current: Release.version,
  }).pipe(
    Effect.timeoutOption("1 second"),
    Effect.map(Option.flatten),
    Effect.orElseSucceed(() => Option.none<string>()),
  )
  if (Option.isSome(needed))
    return yield* new Output.Failure({
      message: `ren2 v${Release.version} no longer works with Ren, which needs v${needed.value} or later. Run ren2 upgrade.`,
    })
})

export const notice = Effect.gen(function* () {
  const output = yield* Output.Service
  const quiet =
    !Release.compiled ||
    output.format !== "pretty" ||
    !process.stderr.isTTY ||
    Boolean(process.env.CI) ||
    Boolean(process.env.REN2_NO_UPDATE_CHECK) ||
    process.argv.includes("upgrade")
  if (quiet) return Option.none<string>()
  return yield* available({
    host: host(),
    cache: join(Directories.config(), "update.json"),
    current: Release.version,
  }).pipe(
    Effect.timeoutOption("1 second"),
    Effect.map(Option.flatten),
    Effect.orElseSucceed(() => Option.none<string>()),
  )
})
