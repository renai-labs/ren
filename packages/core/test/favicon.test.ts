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

const routes: Readonly<Record<string, (url: URL, request: Request) => Response>> = {
  "ok.example.com": () => new Response(png, { headers: { "content-type": "image/png" } }),
  "vector.example.com": () => new Response(svg, { headers: { "content-type": "image/svg+xml" } }),
  "gone.example.com": () => new Response("no", { status: 404 }),
  "large.example.com": () => new Response(large),
  "moved.example.com": () =>
    new Response(null, { status: 301, headers: { location: "https://ok.example.com/icon.png" } }),
  "loop.example.com": (url) =>
    url.pathname.endsWith("/favicon.ico")
      ? new Response(null, { status: 302, headers: { location: "/favicon.ico" } })
      : new Response("no", { status: 404 }),
  "declared.example.com": (url) => {
    if (url.pathname === "/declared.example.com/images/favicon.ico")
      return new Response(png, { headers: { "content-type": "image/x-icon" } })
    if (url.pathname === "/declared.example.com/")
      return page(
        `<link rel="mask-icon" href="/mask.svg"><link rel="shortcut icon" type="image/x-icon" href="/images/favicon.ico"/>`,
      )
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } })
  },
  "agents.example.com": (_url, request) =>
    request.headers.get("user-agent")?.includes("Ren")
      ? new Response(png, { headers: { "content-type": "image/png" } })
      : new Response("forbidden", { status: 403 }),
  "private.example.com": (url) =>
    url.pathname === "/private.example.com/"
      ? page(`<link rel="icon" href="https://127.0.0.1/favicon.png">`)
      : new Response("no", { status: 404 }),
}

function page(head: string) {
  return new Response(`<!doctype html><html><head>${head}</head><body></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  })
}

const server = Bun.serve({
  port: 0,
  fetch: (request) => {
    const url = new URL(request.url)
    requests.push(url.pathname)
    const host = url.pathname.split("/")[1] ?? ""
    return routes[host]?.(url, request) ?? new Response("missing", { status: 404 })
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
      expect(count("loop.example.com")).toBe(Favicon.maximumRedirects + 2)
    }),
  )

  it.effect("does not fetch a miss again", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      yield* favicon.read("gone.example.com")
      const first = count("gone.example.com")
      yield* favicon.read("gone.example.com")
      expect(count("gone.example.com")).toBe(first)
    }),
  )

  it.effect("names itself, as sites such as Wikipedia refuse a request without a User-Agent", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      expect(Option.isSome(yield* favicon.read("agents.example.com"))).toBe(true)
    }),
  )

  it.effect("uses the icon a site's page declares when it has no /favicon.ico", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      const icon = yield* favicon.read("declared.example.com")
      expect(Option.map(icon, (found) => found.bytes.length)).toEqual(Option.some(png.length))
    }),
  )

  it.effect("refuses an icon a page declares on a private host and never requests it", () =>
    Effect.gen(function* () {
      const favicon = yield* Favicon.Service
      expect(Option.isNone(yield* favicon.read("private.example.com"))).toBe(true)
      expect(count("127.0.0.1")).toBe(0)
    }),
  )
})
