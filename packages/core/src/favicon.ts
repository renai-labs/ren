export * as Favicon from "./favicon.js"

import { PublicHost } from "@ren/util/public-host"
import { Cache, Context, Duration, Effect, Exit, Layer, Option, Semaphore } from "effect"
import { OAuthFetch } from "./oauth-fetch.js"

export interface Icon {
  readonly type: string
  readonly bytes: Uint8Array
}

export interface Interface {
  readonly read: (host: string) => Effect.Effect<Option.Option<Icon>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Favicon") {}

export const maximumBytes = 32 * 1024

export const maximumRedirects = 3

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

const sniff = (bytes: Uint8Array) => signatures.find((signature) => signature.matches(bytes))?.type

const icon = (bytes: Uint8Array) => {
  const type = sniff(bytes)
  return bytes.length <= maximumBytes && type ? Option.some({ type, bytes }) : Option.none<Icon>()
}

const redirects = new Set([301, 302, 303, 307, 308])

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const oauthFetch = yield* OAuthFetch.Service
    const fetching = yield* Semaphore.make(6)

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
        const next = URL.parse(location, url)
        if (next?.port !== "") return Option.none<Icon>()
        url = next
      }
      return Option.none<Icon>()
    })

    const cache = yield* Cache.makeWith(
      (host: string) =>
        fetching
          .withPermit(download(host).pipe(Effect.timeout(Duration.seconds(3))))
          .pipe(Effect.catch(() => Effect.succeed(Option.none<Icon>()))),
      {
        capacity: 1_000,
        timeToLive: (exit) => (Exit.isSuccess(exit) && Option.isSome(exit.value) ? Duration.days(7) : Duration.days(1)),
      },
    )

    return Service.of({
      read: Effect.fn("Favicon.read")(function* (host) {
        const name = host.toLowerCase().replace(/\.$/u, "")
        if (!PublicHost.isPublic(name)) return Option.none<Icon>()
        return yield* Cache.get(cache, name)
      }),
    })
  }),
)
