import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { Favicon } from "../src/favicon.js"
import { OAuthFetch } from "../src/oauth-fetch.js"
import { testEffect } from "./lib/effect.js"

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
const large = new Uint8Array(Favicon.maximumBytes + 1)
large.set(png)

const requests: Array<string> = []

const routes: Readonly<Record<string, (url: URL) => Response>> = {
  "ok.example.com": () => new Response(png, { headers: { "content-type": "image/png" } }),
  "vector.example.com": () => new Response(svg, { headers: { "content-type": "image/svg+xml" } }),
  "gone.example.com": () => new Response("no", { status: 404 }),
  "large.example.com": () => new Response(large),
  "moved.example.com": () =>
    new Response(null, { status: 301, headers: { location: "https://ok.example.com/icon.png" } }),
  "loop.example.com": () => new Response(null, { status: 302, headers: { location: "/favicon.ico" } }),
}

const server = Bun.serve({
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url)
    requests.push(url.pathname)
    const host = url.pathname.split("/")[1] ?? ""
    return routes[host]?.(url) ?? new Response("missing", { status: 404 })
  },
})
afterAll(() => server.stop(true))

const fixture = Layer.succeed(
  OAuthFetch.Service,
  OAuthFetch.Service.of({
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      return fetch(`http://127.0.0.1:${server.port}/${url.hostname}${url.pathname}`, init)
    },
  }),
)

const it = testEffect(Favicon.layer.pipe(Layer.provide(fixture)))

const count = (host: string) => requests.filter((path) => path.startsWith(`/${host}/`)).length

describe("Favicon", () => {
  it.effect("serves a PNG with its sniffed type", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      const icon = yield* favicon.read("ok.example.com")
      expect(Option.map(icon, (found) => found.type)).toEqual(Option.some("image/png"))
      expect(Option.map(icon, (found) => found.bytes.length)).toEqual(Option.some(png.length))
    }),
  )

  it.effect("follows a redirect", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      const icon = yield* favicon.read("moved.example.com")
      expect(Option.isSome(icon)).toBe(true)
    }),
  )

  it.effect("refuses SVG, which could run script from Ren's origin", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      expect(Option.isNone(yield* favicon.read("vector.example.com"))).toBe(true)
    }),
  )

  it.effect("refuses an icon larger than the cap", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      expect(Option.isNone(yield* favicon.read("large.example.com"))).toBe(true)
    }),
  )

  it.effect("refuses a private host and never requests it", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      expect(Option.isNone(yield* favicon.read("127.0.0.1"))).toBe(true)
      expect(Option.isNone(yield* favicon.read("localhost"))).toBe(true)
      expect(count("127.0.0.1")).toBe(0)
      expect(count("localhost")).toBe(0)
    }),
  )

  it.effect("stops a redirect loop", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      expect(Option.isNone(yield* favicon.read("loop.example.com"))).toBe(true)
      expect(count("loop.example.com")).toBe(Favicon.maximumRedirects + 1)
    }),
  )

  it.effect("does not fetch a miss again", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      yield* favicon.read("gone.example.com")
      yield* favicon.read("gone.example.com")
      expect(count("gone.example.com")).toBe(1)
    }),
  )
})
