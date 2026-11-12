import { afterAll, describe, expect } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { TestClock } from "effect/testing"
import { Favicon } from "../src/favicon.js"
import { OAuthFetch } from "../src/oauth-fetch.js"
import { testEffect } from "./lib/effect.js"

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const svg = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)

const requests: Array<string> = []

const routes: Readonly<Record<string, (url: URL) => Response>> = {
  "ok.example.com": () => new Response(png, { headers: { "content-type": "image/png" } }),
  "vector.example.com": () => new Response(svg, { headers: { "content-type": "image/svg+xml" } }),
  "gone.example.com": () => new Response("no", { status: 404 }),
  "large.example.com": () => new Response(new Uint8Array(Favicon.maximumBytes + 1).fill(1)),
  "moved.example.com": () =>
    new Response(null, { status: 301, headers: { location: "https://ok.example.com/icon.png" } }),
  "loop.example.com": () => new Response(null, { status: 302, headers: { location: "/favicon.ico" } }),
  "inside.example.com": () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret" } }),
  "named.example.com": () => new Response(null, { status: 302, headers: { location: "https://db.internal/secret" } }),
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
      const icon = yield* favicon.read("alice", "ok.example.com")
      expect(Option.map(icon, (found) => found.type)).toEqual(Option.some("image/png"))
      expect(Option.map(icon, (found) => found.bytes.length)).toEqual(Option.some(png.length))
    }),
  )

  it.effect("follows a redirect to a public host", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      const icon = yield* favicon.read("alice", "moved.example.com")
      expect(Option.isSome(icon)).toBe(true)
    }),
  )

  it.effect("refuses SVG, which could run script from Ren's origin", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      expect(Option.isNone(yield* favicon.read("alice", "vector.example.com"))).toBe(true)
    }),
  )

  it.effect("refuses an icon larger than the cap", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      expect(Option.isNone(yield* favicon.read("alice", "large.example.com"))).toBe(true)
    }),
  )

  it.effect("refuses a private host and a redirect to a private address, and never requests them", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      expect(Option.isNone(yield* favicon.read("alice", "127.0.0.1"))).toBe(true)
      expect(Option.isNone(yield* favicon.read("alice", "localhost"))).toBe(true)
      expect(Option.isNone(yield* favicon.read("alice", "inside.example.com"))).toBe(true)
      expect(Option.isNone(yield* favicon.read("alice", "named.example.com"))).toBe(true)
      expect(requests.filter((path) => path.includes("secret") || path.startsWith("/127.0.0.1"))).toEqual([])
      expect(count("localhost")).toBe(0)
    }),
  )

  it.effect("stops a redirect loop", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      expect(Option.isNone(yield* favicon.read("alice", "loop.example.com"))).toBe(true)
      expect(count("loop.example.com")).toBe(Favicon.maximumRedirects + 1)
    }),
  )

  it.effect("caches a miss for a day and a hit for a week", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      yield* favicon.read("alice", "gone.example.com")
      yield* favicon.read("alice", "gone.example.com")
      expect(count("gone.example.com")).toBe(1)
      yield* TestClock.adjust("23 hours")
      yield* favicon.read("alice", "gone.example.com")
      expect(count("gone.example.com")).toBe(1)
      yield* TestClock.adjust("2 hours")
      yield* favicon.read("alice", "gone.example.com")
      expect(count("gone.example.com")).toBe(2)

      yield* favicon.read("alice", "ok.example.com")
      const before = count("ok.example.com")
      yield* TestClock.adjust("6 days")
      yield* favicon.read("alice", "ok.example.com")
      expect(count("ok.example.com")).toBe(before)
      yield* TestClock.adjust("2 days")
      yield* favicon.read("alice", "ok.example.com")
      expect(count("ok.example.com")).toBe(before + 1)
    }),
  )

  it.effect("allows 120 new hosts a minute for each person, and cached hosts are free", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      for (let index = 0; index < Favicon.hostsPerMinute; index++) yield* favicon.read("bob", `h${index}.example.com`)
      const refused = yield* Effect.flip(favicon.read("bob", "extra.example.com"))
      expect(refused._tag).toBe("Favicon.RateLimited")
      expect(Option.isNone(yield* favicon.read("bob", "h0.example.com"))).toBe(true)
      expect(Option.isNone(yield* favicon.read("carol", "extra.example.com"))).toBe(true)
      yield* TestClock.adjust("1 minute")
      expect(Option.isNone(yield* favicon.read("bob", "extra.example.com"))).toBe(true)
    }),
  )
})
