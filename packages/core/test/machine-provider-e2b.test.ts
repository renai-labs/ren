import { afterAll, describe, expect } from "bun:test"
import { BrainProvider } from "../src/brain-provider.js"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Space } from "@ren/schema/space"
import { ConfigProvider, DateTime, Effect, Layer, Option, Redacted } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { E2BSandbox } from "../src/machine-provider/e2b.js"
import { MachineProvider } from "../src/machine-provider.js"
import { testEffect } from "./lib/effect.js"

interface Seen {
  readonly method: string
  readonly host: string
  readonly path: string
  readonly query: URLSearchParams
  readonly body: string
}

const seen: Array<Seen> = []

// oxlint-disable-next-line ren/no-comments -- The tags of the E2B templates that the fake has built, and the status its next build ends with.
const built = new Map<string, Array<string>>()
const builds = { status: "ready" as "ready" | "error" }

const newest = Date.parse("2026-10-29T12:00:00Z")

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

// oxlint-disable-next-line ren/no-comments -- Fixed answers by path: a resume, a network update, and the template build API (tags, a build request, its steps and its status).
const answers: Readonly<Record<string, () => Response>> = {
  "/sandboxes/sbx_1/connect": () => Response.json({ sandboxID: "sbx_1" }),
  "/sandboxes/sbx_1/network": () => new Response(null, { status: 204 }),
  "/v3/templates": () => {
    const requested = JSON.parse(seen.at(-1)?.body ?? "{}")
    if (builds.status === "ready") built.set(requested.name, [...(built.get(requested.name) ?? []), ...requested.tags])
    return Response.json({ templateID: "e2b_tpl", buildID: "bld_1" }, { status: 202 })
  },
  "/v2/templates/e2b_tpl/builds/bld_1": () => new Response(null, { status: 202 }),
  "/templates/e2b_tpl/builds/bld_1/status": () =>
    Response.json(
      builds.status === "ready"
        ? { status: "ready" }
        : {
            status: "error",
            reason: { message: "step 2 failed", logEntries: [{ message: "E: Unable to locate package nope" }] },
          },
    ),
}

const tagsOf = (name: string) => () =>
  built.has(name)
    ? Response.json((built.get(name) ?? []).map((tag) => ({ tag })))
    : new Response("not found", { status: 404 })

const answerOf = (url: URL) => {
  const name = url.pathname.match(/^\/templates\/([^/]+)\/tags$/)?.[1]
  return name ? tagsOf(name) : answers[url.pathname]
}

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
        url.searchParams.get("metadata")?.includes("brain=brn_paused")
          ? [{ sandboxID: "sbx_1", state: "paused", metadata: { owner: "ren-test-a", brain: "brn_paused" } }]
          : url.searchParams.get("metadata")?.includes("brain=")
            ? []
            : [
                {
                  sandboxID: "sbx_mine",
                  state: "running",
                  metadata: { owner: "ren-test-a", brain: "brn_01", generation: "1" },
                },
                {
                  sandboxID: "sbx_theirs",
                  state: "running",
                  metadata: { owner: "ren-v2-dev", brain: "brn_02", generation: "1" },
                },
              ],
      )
    if (url.pathname === "/sandboxes" && request.method === "POST")
      return Response.json({ sandboxID: "sbx_1", domain: "e2b.test", envdAccessToken: "envd" })
    if (url.pathname === "/files") return Response.json([{ path: url.searchParams.get("path") }])
    const answer = answerOf(url)
    if (answer) return answer()
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
  BrainProvider.layer([E2BSandbox.provider]).pipe(
    Layer.provide(local),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          E2B_API_KEY: "e2b_test",
          E2B_DOMAIN: "e2b.test",
          E2B_API_URL: `http://127.0.0.1:${e2b.port}`,
          E2B_OWNER: "ren-test-a",
          E2B_VCPU_SECOND_MICRO_USD: "14",
          E2B_GIB_SECOND_MICRO_USD: "4.5",
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
      const provider = yield* BrainProvider.first
      seen.length = 0
      const created = yield* provider.create({
        labels: { kind: "brain", id: Brain.ID.make("brn_01"), generation: 1, ...owner },
        config: {},
        variables: { REN_BRAIN_ID: "brn_01" },
        image: Option.none(),
        network: { proxy: Option.some(proxy), hosts: Option.none() },
      })
      const create = seen.find((request) => request.path === "/sandboxes" && request.method === "POST")
      expect(JSON.parse(create?.body ?? "{}")).toMatchObject({ network })
      const files = seen.filter((request) => request.path === "/files").map((request) => request.host)
      expect(files).toEqual(["49983-sbx_1.e2b.test", "49983-sbx_1.e2b.test"])
      expect(seen.some((request) => request.body.includes("BEGIN CERTIFICATE"))).toBe(true)

      seen.length = 0
      yield* provider.connect(created.binding, { proxy: Option.some(proxy), hosts: Option.none() })
      const update = seen.find((request) => request.path === "/sandboxes/sbx_1/network")
      expect(update?.method).toBe("PUT")
      expect(JSON.parse(update?.body ?? "{}")).toEqual(network)
    }),
  )

  it.live("this Ren sees only the sandboxes of its E2B_OWNER, so its cleanup never destroys another Ren's", () =>
    Effect.gen(function* () {
      const provider = yield* BrainProvider.first
      seen.length = 0
      expect((yield* provider.list).map((each) => each.binding)).toEqual([
        { sandboxId: "sbx_mine", domain: "e2b.test", port: 4800 },
      ])
      yield* provider.create({
        labels: { kind: "brain", id: Brain.ID.make("brn_03"), generation: 1, ...owner },
        config: {},
        variables: {},
        image: Option.none(),
        network: MachineProvider.unrestricted,
      })
      const create = seen.find((request) => request.path === "/sandboxes" && request.method === "POST")
      expect(JSON.parse(create?.body ?? "{}").metadata).toEqual({
        owner: "ren-test-a",
        brain: "brn_03",
        generation: "1",
        kind: "brain",
        organization: "org_01",
        space: "spc_01",
      })
    }),
  )

  it.live("a create that finds its sandbox paused resumes it before the network update, and makes no other", () =>
    Effect.gen(function* () {
      const provider = yield* BrainProvider.first
      seen.length = 0
      yield* provider.create({
        labels: { kind: "brain", id: Brain.ID.make("brn_paused"), generation: 1, ...owner },
        config: {},
        variables: {},
        image: Option.none(),
        network: { proxy: Option.some(proxy), hosts: Option.none() },
      })
      expect(
        seen
          .filter((request) => request.path.startsWith("/sandboxes"))
          .map((request) => `${request.method} ${request.path}`),
      ).toEqual(["POST /sandboxes/sbx_1/connect", "PUT /sandboxes/sbx_1/network"])
    }),
  )

  it.live("without an egress, a create sends no network config", () =>
    Effect.gen(function* () {
      const provider = yield* BrainProvider.first
      seen.length = 0
      yield* provider.create({
        labels: { kind: "brain", id: Brain.ID.make("brn_02"), generation: 1, ...owner },
        config: {},
        variables: {},
        image: Option.none(),
        network: MachineProvider.unrestricted,
      })
      const create = seen.find((request) => request.path === "/sandboxes" && request.method === "POST")
      expect(JSON.parse(create?.body ?? "{}").network).toBeUndefined()
    }),
  )
})

describe("E2BSandbox template builds", () => {
  const buildOf = Effect.map(BrainProvider.first, (provider) => Option.getOrThrow(provider.build))

  it.live(
    "a build starts from the system image with one RUN per package manager and per build command; the same config again gives its image at once (templates rule 4)",
    () =>
      Effect.gen(function* () {
        const build = yield* buildOf
        const environmentTemplateId = EnvironmentTemplate.ID.make("tpl_01ABCDEFGHJKMNPQRSTVWXYZ00")
        const config = {
          cpuCount: 4,
          memoryMiB: 4096,
          packages: { apt: ["ffmpeg"], pip: ["requests"] },
          buildCommands: ["echo ready > ~/ready"],
        }
        seen.length = 0
        builds.status = "ready"
        const image = yield* build({ environmentTemplateId, config })
        expect(image).toMatch(/^ren-template-01abcdefghjkmnpqrstvwxyz00:[0-9a-f]{16}$/)
        const requested = seen.find((request) => request.path === "/v3/templates")
        expect(JSON.parse(requested?.body ?? "{}")).toMatchObject({ cpuCount: 4, memoryMB: 4096 })
        const steps = JSON.parse(
          seen.find((request) => request.path === "/v2/templates/e2b_tpl/builds/bld_1")?.body ?? "{}",
        )
        expect(steps).toMatchObject({ fromTemplate: "ren-brain-dev", startCmd: "/opt/ren/start.sh" })
        expect(steps.steps.map((step: { readonly args: ReadonlyArray<string> }) => step.args)).toEqual([
          ["apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y 'ffmpeg'", "root"],
          [
            "(command -v pip3 || (apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip)) && pip3 install --break-system-packages 'requests'",
            "root",
          ],
          ["echo ready > ~/ready", "user"],
        ])
        seen.length = 0
        expect(yield* build({ environmentTemplateId, config })).toBe(image)
        expect(seen.some((request) => request.path === "/v3/templates")).toBe(false)
      }),
  )

  it.live("a failed build fails with E2B's reason and the last lines of its log (templates rule 3)", () =>
    Effect.gen(function* () {
      const build = yield* buildOf
      builds.status = "error"
      const failed = yield* build({
        environmentTemplateId: EnvironmentTemplate.ID.make("tpl_01ABCDEFGHJKMNPQRSTVWXYZ01"),
        config: { packages: { apt: ["nope"] } },
      }).pipe(Effect.flip)
      builds.status = "ready"
      expect(failed.message).toBe("step 2 failed\nE: Unable to locate package nope")
    }),
  )
})

describe("E2BSandbox templates on a machine", () => {
  it.live(
    "a machine of a template starts from its image and gets its host list, with the apex of each wildcard (networking rules 3, 4)",
    () =>
      Effect.gen(function* () {
        const provider = yield* BrainProvider.first
        seen.length = 0
        const created = yield* provider.create({
          labels: { kind: "brain", id: Brain.ID.make("brn_04"), generation: 1, ...owner },
          config: {},
          image: Option.some("ren-template-x:abc"),
          variables: {},
          network: { proxy: Option.some(proxy), hosts: Option.some(["api.example.com", "*.example.org"]) },
        })
        const create = JSON.parse(
          seen.find((request) => request.path === "/sandboxes" && request.method === "POST")?.body ?? "{}",
        )
        const limited = { ...network, allowOut: ["api.example.com", "*.example.org", "example.org"] }
        expect(create).toMatchObject({ templateID: "ren-template-x:abc", network: limited })
        seen.length = 0
        yield* provider.connect(created.binding, { proxy: Option.some(proxy), hosts: Option.some(["api.example.com"]) })
        const update = seen.find((request) => request.path === "/sandboxes/sbx_1/network")
        expect(JSON.parse(update?.body ?? "{}")).toEqual({ ...network, allowOut: ["api.example.com"] })
      }),
  )

  it.effect(
    "a config that only adds packages or build commands gives their steps; a removed package, a changed command or a new size gives none (templates rules 2, 3)",
    () =>
      Effect.gen(function* () {
        const provider = yield* BrainProvider.first
        const from = { packages: { apt: ["ffmpeg"] }, buildCommands: ["make"] }
        expect(
          provider.stepsBetween(from, {
            packages: { apt: ["ffmpeg"], pip: ["requests"] },
            buildCommands: ["make", "make test"],
          }),
        ).toEqual(
          Option.some([
            {
              command:
                "(command -v pip3 || (apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y python3-pip)) && pip3 install --break-system-packages 'requests'",
              user: "root",
            },
            { command: "make test", user: "user" },
          ]),
        )
        expect(provider.stepsBetween(from, { packages: {}, buildCommands: ["make"] })).toEqual(Option.none())
        expect(provider.stepsBetween(from, { ...from, buildCommands: ["make all"] })).toEqual(Option.none())
        expect(provider.stepsBetween(from, { ...from, cpuCount: 4, memoryMiB: 4096 })).toEqual(Option.none())
      }),
  )
})

describe("E2BSandbox metering", () => {
  it.live("reads E2B's run events page by page, newest first, and stops at the page that reaches since", () =>
    Effect.gen(function* () {
      const provider = yield* BrainProvider.first
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

describe("E2BSandbox hands", () => {
  it.live("E2B's 502 for a sandbox that is not there is not an executor's answer; the executor's own 401 is", () =>
    Effect.gen(function* () {
      const edge = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: (request) =>
          new URL(request.url).pathname.startsWith("/gone/")
            ? Response.json({ message: "The sandbox was not found", code: 502 }, { status: 502 })
            : Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 }),
      })
      yield* Effect.addFinalizer(() => Effect.promise(() => edge.stop(true)))
      const http = yield* HttpClient.HttpClient
      const answers = (path: string) =>
        MachineProvider.executorAnswers(http, new URL(path, edge.url)).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        )
      expect([yield* answers("/gone/"), yield* answers("/")]).toEqual([false, true])
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer)),
  )
})
