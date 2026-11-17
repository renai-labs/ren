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

export const maximumPageBytes = 512 * 1024

// oxlint-disable-next-line ren/no-comments -- Many sites, such as Wikipedia, Reddit and Stack Overflow, refuse a request that does not say what sent it.
const userAgent = "Mozilla/5.0 (compatible; Ren/1.0; favicon fetcher)"

const attribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu").exec(tag)?.slice(1).find(Boolean)

// oxlint-disable-next-line ren/no-comments -- The icons a page declares in its <link> tags, browser icons before Apple's touch icons. An SVG or a mask icon is skipped: Ren refuses SVG, which could run script from its origin.
const declared = (html: string, base: URL) =>
  [...html.matchAll(/<link\b[^>]*>/giu)]
    .map((match) => match.at(0) ?? "")
    .map((tag) => ({ rel: attribute(tag, "rel")?.toLowerCase() ?? "", href: attribute(tag, "href") }))
    .filter((link) => /(?:^|\s)(?:icon|apple-touch-icon)(?:\s|$)/u.test(link.rel) && link.href)
    .toSorted((a, b) => Number(a.rel.includes("apple")) - Number(b.rel.includes("apple")))
    .flatMap((link) => {
      const url = URL.parse(link.href ?? "", base)
      return url?.protocol === "https:" && !url.pathname.toLowerCase().endsWith(".svg") ? [url] : []
    })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const oauthFetch = yield* OAuthFetch.Service
    const fetching = yield* Semaphore.make(6)

    // oxlint-disable-next-line ren/no-comments -- Follows redirects by hand, on the default port of a public host only, so a site cannot point Ren at a private address.
    const follow = Effect.fn("Favicon.follow")(function* (start: URL, accept: string) {
      let url = start
      for (let hop = 0; hop <= maximumRedirects; hop++) {
        if (url.port !== "" || !PublicHost.isPublic(url.hostname)) return Option.none<Response>()
        const response = yield* Effect.tryPromise((signal) =>
          oauthFetch.fetch(url, { redirect: "manual", signal, headers: { accept, "user-agent": userAgent } }),
        )
        const location = redirects.has(response.status) ? response.headers.get("location") : null
        if (!location) return response.ok ? Option.some({ response, url }) : Option.none()
        const next = URL.parse(location, url)
        if (!next) return Option.none()
        url = next
      }
      return Option.none()
    })

    const image = Effect.fn("Favicon.image")(function* (url: URL) {
      const found = yield* follow(url, "image/*")
      if (Option.isNone(found)) return Option.none<Icon>()
      return icon(new Uint8Array(yield* Effect.tryPromise(() => found.value.response.arrayBuffer())))
    })

    // oxlint-disable-next-line ren/no-comments -- /favicon.ico first; a site without one, such as app.notion.com, names its icon in the <link> tags of its page.
    const download = Effect.fn("Favicon.download")(function* (host: string) {
      const root = yield* image(new URL(`https://${host}/favicon.ico`))
      if (Option.isSome(root)) return root
      const page = yield* follow(new URL(`https://${host}/`), "text/html")
      if (Option.isNone(page)) return Option.none<Icon>()
      const bytes = new Uint8Array(yield* Effect.tryPromise(() => page.value.response.arrayBuffer()))
      const html = new TextDecoder().decode(bytes.subarray(0, maximumPageBytes))
      for (const url of declared(html, page.value.url).slice(0, 3)) {
        const found = yield* image(url)
        if (Option.isSome(found)) return found
      }
      return Option.none<Icon>()
    })

    const cache = yield* Cache.makeWith(
      (host: string) =>
        fetching
          .withPermit(download(host).pipe(Effect.timeout(Duration.seconds(5))))
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
