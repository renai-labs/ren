export * as Favicon from "./favicon.js"

import { PublicHost } from "@ren/util/public-host"
import { Cache, Clock, Context, Data, Duration, Effect, Exit, Layer, Option } from "effect"
import { OAuthFetch } from "./oauth-fetch.js"

export interface Icon {
  readonly type: string
  readonly bytes: Uint8Array
}

export class RateLimited extends Data.TaggedError("Favicon.RateLimited")<{}> {}

export interface Interface {
  readonly read: (person: string, host: string) => Effect.Effect<Option.Option<Icon>, RateLimited>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Favicon") {}

export const maximumBytes = 100_000

export const timeout = Duration.seconds(3)

export const maximumRedirects = 3

export const hitLifetime = Duration.days(7)

export const missLifetime = Duration.days(1)

export const capacity = 10_000

export const hostsPerMinute = 120

const signatures: ReadonlyArray<{ readonly type: string; readonly matches: (bytes: Uint8Array) => boolean }> = [
  { type: "image/png", matches: (bytes) => startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { type: "image/gif", matches: (bytes) => startsWith(bytes, 0, [0x47, 0x49, 0x46, 0x38]) },
  { type: "image/jpeg", matches: (bytes) => startsWith(bytes, 0, [0xff, 0xd8, 0xff]) },
  {
    type: "image/webp",
    matches: (bytes) =>
      startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50]),
  },
  { type: "image/x-icon", matches: (bytes) => startsWith(bytes, 0, [0x00, 0x00, 0x01, 0x00]) },
]

const startsWith = (bytes: Uint8Array, offset: number, prefix: ReadonlyArray<number>) =>
  prefix.every((value, index) => bytes[offset + index] === value)

export const sniff = (bytes: Uint8Array) => signatures.find((signature) => signature.matches(bytes))?.type

const icon = (bytes: Uint8Array) => {
  const type = sniff(bytes)
  return bytes.length > 0 && bytes.length <= maximumBytes && type ? Option.some({ type, bytes }) : Option.none<Icon>()
}

const redirectTarget = (location: string, from: URL) => {
  if (!URL.canParse(location, from)) return null
  const next = new URL(location, from)
  const plain = next.protocol === "https:" && next.port === "" && next.username === "" && next.password === ""
  return plain && PublicHost.isPublic(next.hostname) ? next : null
}

const redirects = new Set([301, 302, 303, 307, 308])

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const oauthFetch = yield* OAuthFetch.Service
    const windows = new Map<string, { readonly start: number; readonly count: number }>()

    const download = Effect.fn("Favicon.download")(function* (host: string) {
      let url = new URL(`https://${host}/favicon.ico`)
      for (let hop = 0; hop <= maximumRedirects; hop++) {
        const response = yield* Effect.tryPromise((signal) =>
          oauthFetch.fetch(url, { redirect: "manual", signal, headers: { accept: "image/*" } }),
        )
        const location = redirects.has(response.status) ? response.headers.get("location") : null
        if (!location)
          return response.ok
            ? icon(new Uint8Array(yield* Effect.tryPromise(() => response.arrayBuffer())))
            : Option.none()
        const next = redirectTarget(location, url)
        if (!next) return Option.none<Icon>()
        url = next
      }
      return Option.none<Icon>()
    })

    const cache = yield* Cache.makeWith(
      (host: string) =>
        download(host).pipe(
          Effect.timeout(timeout),
          Effect.catch(() => Effect.succeed(Option.none<Icon>())),
        ),
      {
        capacity,
        timeToLive: (exit) => (Exit.isSuccess(exit) && Option.isSome(exit.value) ? hitLifetime : missLifetime),
      },
    )

    const admit = Effect.fn("Favicon.admit")(function* (person: string) {
      const now = yield* Clock.currentTimeMillis
      const window = windows.get(person)
      const current = window && now - window.start < 60_000 ? window : { start: now, count: 0 }
      if (current.count >= hostsPerMinute) return false
      windows.set(person, { start: current.start, count: current.count + 1 })
      if (windows.size > 1000) for (const [key, each] of windows) if (now - each.start >= 60_000) windows.delete(key)
      return true
    })

    return Service.of({
      read: Effect.fn("Favicon.read")(function* (person, host) {
        const name = host.toLowerCase().replace(/\.$/u, "")
        if (!PublicHost.isPublic(name)) return Option.none<Icon>()
        const known = yield* Cache.getOption(cache, name)
        if (Option.isSome(known)) return known.value
        if (!(yield* admit(person))) return yield* new RateLimited()
        return yield* Cache.get(cache, name)
      }),
    })
  }),
)
