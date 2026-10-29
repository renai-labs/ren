import { afterAll, describe, expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import { ConfigProvider, DateTime, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { E2BSandbox } from "../src/sandbox-provider/e2b.js"
import { SandboxProvider } from "../src/sandbox-provider.js"
import { testEffect } from "./lib/effect.js"

interface Seen {
  readonly method: string
  readonly host: string
  readonly path: string
  readonly query: URLSearchParams
  readonly body: string
}

const seen: Array<Seen> = []

const newest = Date.parse("2026-10-29T12:00:00Z")

// oxlint-disable-next-line ren/no-comments -- 250 runs of one brain, one minute apart, newest first, as E2B lists them.
const runs = Array.from({ length: 250 }, (_, index) => ({
  id: `event-${index}`,
  type: "sandbox.lifecycle.paused",
  timestamp: new Date(newest - index * 60_000).toISOString(),
  sandboxId: "sbx_1",
  eventData: {
    sandbox_metadata: {
      owner: "ren-test-a",
      brain: "brn_01",
      generation: "1",
      organization: "org_01",
      space: "spc_01",
    },
    execution: { started_at: "2026-10-29T11:00:00Z", vcpu_count: 2, memory_mb: 2048, execution_time: 60_000 },
    pause_mode: "full",
  },
}))

// oxlint-disable-next-line ren/no-comments -- A local server answers as the E2B API and as envd. The client below sends every request here and keeps the host it meant in x-target-host.
const e2b = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: async (request) => {
    const url = new URL(request.url)
    seen.push({
      method: request.method,
      host: request.headers.get("x-target-host") ?? "",
      path: url.pathname,
      query: url.searchParams,
      body: await request.text(),
    })
    if (url.pathname === "/v2/sandboxes")
      return Response.json(
        url.searchParams.get("metadata")?.includes("brain=")
          ? []
          : [
              { sandboxID: "sbx_mine", state: "running", metadata: { owner: "ren-test-a", brain: "brn_01" } },
              { sandboxID: "sbx_theirs", state: "running", metadata: { owner: "ren-v2-dev", brain: "brn_02" } },
            ],
      )
    if (url.pathname === "/sandboxes" && request.method === "POST")
      return Response.json({ sandboxID: "sbx_1", domain: "e2b.test", envdAccessToken: "envd" })
    if (url.pathname === "/sandboxes/sbx_1/connect") return Response.json({ sandboxID: "sbx_1" })
    if (url.pathname === "/sandboxes/sbx_1/network") return new Response(null, { status: 204 })
    if (url.pathname === "/files") return Response.json([{ path: url.searchParams.get("path") }])
    if (url.pathname === "/events/sandboxes") {
      const offset = Number(url.searchParams.get("offset") ?? "0")
      return Response.json(runs.slice(offset, offset + Number(url.searchParams.get("limit"))))
    }
    return new Response("not found", { status: 404 })
  },
})
afterAll(() => e2b.stop(true))

const local = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return HttpClient.mapRequest(client, (request) => {
      const url = URL.parse(request.url)
      if (!url) return request
      return request.pipe(
        HttpClientRequest.setUrl(`http://127.0.0.1:${e2b.port}${url.pathname}${url.search}`),
        HttpClientRequest.setHeader("x-target-host", url.host),
      )
    })
  }),
).pipe(Layer.provide(FetchHttpClient.layer))

const it = testEffect(
  E2BSandbox.layer.pipe(
    Layer.provide(local),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          E2B_API_KEY: "e2b_test",
          E2B_DOMAIN: "e2b.test",
          E2B_API_URL: `http://127.0.0.1:${e2b.port}`,
          E2B_OWNER: "ren-test-a",
        }),
      ),
    ),
  ),
)

const proxy = {
  address: "egress.ren.dev:1080",
  username: "ren-login",
  password: Redacted.make("secret"),
  ca: Option.some("-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----\n"),
}

const owner = { organizationId: Auth.OrganizationID.make("org_01"), spaceId: Space.ID.make("spc_01") }

const network = {
  allowOut: ["*"],
  denyOut: ["0.0.0.0/0"],
  egressProxy: { address: "egress.ren.dev:1080", username: "ren-login", password: "secret" },
}

describe("E2BSandbox with an egress", () => {
  it.live("create, resume and every network update carry the proxy login (C38), and the CA reaches the sandbox", () =>
    Effect.gen(function* () {
      const provider = yield* SandboxProvider.Service
      seen.length = 0
      const created = yield* provider.create({
        brainId: Brain.ID.make("brn_01"),
        generation: 1,
        ...owner,
        env: { REN_BRAIN_ID: "brn_01" },
        proxy: Option.some(proxy),
      })
      const create = seen.find((request) => request.path === "/sandboxes" && request.method === "POST")
      expect(JSON.parse(create?.body ?? "{}")).toMatchObject({ network })
      const files = seen.filter((request) => request.path === "/files").map((request) => request.host)
      expect(files).toEqual(["49983-sbx_1.e2b.test", "49983-sbx_1.e2b.test"])
      expect(seen.some((request) => request.body.includes("BEGIN CERTIFICATE"))).toBe(true)

      seen.length = 0
      yield* provider.connect(created.binding, Option.some(proxy))
      const update = seen.find((request) => request.path === "/sandboxes/sbx_1/network")
      expect(update?.method).toBe("PUT")
      expect(JSON.parse(update?.body ?? "{}")).toEqual(network)
    }),
  )

  it.live("this Ren sees only the sandboxes of its E2B_OWNER, so its cleanup never destroys another Ren's", () =>
    Effect.gen(function* () {
      const provider = yield* SandboxProvider.Service
      seen.length = 0
      expect((yield* provider.list).map((each) => each.binding)).toEqual([
        { sandboxId: "sbx_mine", domain: "e2b.test", port: 4800 },
      ])
      yield* provider.create({
        brainId: Brain.ID.make("brn_03"),
        generation: 1,
        ...owner,
        env: {},
        proxy: Option.none(),
      })
      const create = seen.find((request) => request.path === "/sandboxes" && request.method === "POST")
      expect(JSON.parse(create?.body ?? "{}").metadata).toEqual({
        owner: "ren-test-a",
        brain: "brn_03",
        generation: "1",
        organization: "org_01",
        space: "spc_01",
      })
    }),
  )

  it.live("without an egress, a create sends no network config", () =>
    Effect.gen(function* () {
      const provider = yield* SandboxProvider.Service
      seen.length = 0
      yield* provider.create({
        brainId: Brain.ID.make("brn_02"),
        generation: 1,
        ...owner,
        env: {},
        proxy: Option.none(),
      })
      const create = seen.find((request) => request.path === "/sandboxes" && request.method === "POST")
      expect(JSON.parse(create?.body ?? "{}").network).toBeUndefined()
    }),
  )
})

describe("E2BSandbox metering", () => {
  it.live("reads E2B's run events page by page, newest first, and stops at the page that reaches since", () =>
    Effect.gen(function* () {
      const provider = yield* SandboxProvider.Service
      const reads = () => seen.filter((request) => request.path === "/events/sandboxes").map((request) => request.query)
      seen.length = 0
      expect(yield* provider.metered(Option.none())).toHaveLength(250)
      expect(reads().map((query) => query.get("offset"))).toEqual(["0", "100", "200"])
      expect(reads()[0]?.getAll("types")).toEqual(["sandbox.lifecycle.paused", "sandbox.lifecycle.killed"])

      seen.length = 0
      const metered = yield* provider.metered(Option.some(DateTime.makeUnsafe(newest - 150 * 60_000)))
      expect(metered.map((span) => span.id)).toEqual(runs.slice(0, 151).map((run) => run.id))
      expect(reads().map((query) => query.get("offset"))).toEqual(["0", "100"])
    }),
  )
})
