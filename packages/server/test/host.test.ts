import { describe, expect, test } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Seed, testEffect } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { BrainToken } from "@ren/host-api/brain-token"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Signature } from "@ren/schema/signature"
import { eq } from "drizzle-orm"
import { Clock, Effect, Layer, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter } from "effect/http"
import { Routes } from "../src/routes.js"
import { brainKey, environment, hostToken, makeApp, services, sign } from "./lib/app.js"

const it = testEffect(
  HttpRouter.serve(Routes.layer, { disableListenLog: true, disableLogger: true }).pipe(
    Layer.provide(services),
    Layer.provide(FetchHttpClient.layer),
    Layer.provideMerge(BunHttpServer.layerTest),
    Layer.provideMerge(Testing.layer),
    Layer.provide(environment()),
  ),
)

const post = Effect.fnUntraced(function* (path: string, token: string) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(HttpClientRequest.post(path).pipe(HttpClientRequest.bearerToken(token)))
  const body = yield* response.json.pipe(Effect.orElseSucceed(() => null))
  return { status: response.status, tag: Schema.decodeUnknownOption(Schema.Struct({ _tag: Schema.String }))(body) }
})

describe("Ren Host API: host token checks", () => {
  it.live(
    "checks run in order: signature, expiry and kind give 401; a missing brain, another org or another brain's session give 403; an old generation gives 403 GenerationRetired",
    () =>
      Effect.gen(function* () {
        const owner = yield* Seed.owner()
        const sessionId = yield* Seed.session(owner)
        const brainId = Brain.ofSession(sessionId)
        const other = yield* Seed.session(owner)
        const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
        const stranger = yield* Signature.generate("stranger")
        const access = (id: string) => `/host/sessions/${id}/environment/access`
        const cases = [
          [
            "/host/token/refresh",
            yield* sign(
              { scope: "host", brain: brainId, gen: 1, org: owner.organizationId, iat: now, exp: now + 600 },
              stranger.privateKey,
            ),
          ],
          ["/host/token/refresh", yield* hostToken(brainId, owner.organizationId, { exp: now - 120 })],
          ["/host/token/refresh", yield* sign({ scope: "server", brain: brainId, gen: 1, exp: now + 600 })],
          ["/host/token/refresh", yield* hostToken(Brain.ID.create(), owner.organizationId)],
          ["/host/token/refresh", yield* hostToken(brainId, Auth.OrganizationID.create())],
          [access(other), yield* hostToken(brainId, owner.organizationId)],
          ["/host/token/refresh", yield* hostToken(brainId, owner.organizationId, { gen: 2 })],
        ] as const
        const answers = yield* Effect.forEach(cases, (entry) => post(entry[0], entry[1]))
        expect(answers.map((answer) => [answer.status, Option.getOrUndefined(answer.tag)?._tag])).toEqual([
          [401, "UnauthorizedError"],
          [401, "UnauthorizedError"],
          [401, "UnauthorizedError"],
          [403, "ForbiddenError"],
          [403, "ForbiddenError"],
          [403, "ForbiddenError"],
          [403, "GenerationRetiredError"],
        ])
      }),
  )

  it.live("a valid host token gets a fresh host token and model access for its brain", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const sessionId = yield* Seed.session(owner)
      const brainId = Brain.ofSession(sessionId)
      const http = yield* HttpClient.HttpClient
      const token = yield* hostToken(brainId, owner.organizationId)
      const refreshed = yield* http
        .execute(HttpClientRequest.post("/host/token/refresh").pipe(HttpClientRequest.bearerToken(token)))
        .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ hostToken: Schema.String }))))
      const models = yield* http
        .execute(HttpClientRequest.post("/host/models/refresh").pipe(HttpClientRequest.bearerToken(token)))
        .pipe(Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Struct({ access: Schema.Unknown }))))
      expect([yield* BrainToken.verify([brainKey.publicKey], refreshed.hostToken), models.access]).toEqual([
        Option.some(expect.objectContaining({ scope: "host", brain: brainId, gen: 1, org: owner.organizationId })),
        { endpoints: [] },
      ])
    }),
  )

  it.live("a session with no environment gets a typed not found", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const sessionId = yield* Seed.session(owner)
      const answer = yield* post(
        `/host/sessions/${sessionId}/environment/access`,
        yield* hostToken(Brain.ofSession(sessionId), owner.organizationId),
      )
      expect([answer.status, Option.getOrUndefined(answer.tag)?._tag]).toEqual([404, "EnvironmentNotFoundError"])
    }),
  )

  it.live("a pull stores the key ids the brain holds", () =>
    Effect.gen(function* () {
      const owner = yield* Seed.owner()
      const sessionId = yield* Seed.session(owner)
      const brainId = Brain.ofSession(sessionId)
      const http = yield* HttpClient.HttpClient
      const database = yield* Database.Service
      yield* http.execute(
        HttpClientRequest.post("/host/pull").pipe(
          HttpClientRequest.bearerToken(yield* hostToken(brainId, owner.organizationId)),
          HttpClientRequest.bodyText(
            JSON.stringify({
              version: "test",
              keyIds: ["k1", "k2"],
              models: null,
              layers: { agents: {} },
              sessions: [],
            }),
            "application/json",
          ),
        ),
      )
      const row = (yield* database.db
        .select({ keyIds: Database.Schema.brain.key_ids })
        .from(Database.Schema.brain)
        .where(eq(Database.Schema.brain.id, brainId))).at(0)
      expect(row?.keyIds).toEqual(["k1", "k2"])
    }),
  )
})

describe("Ren Host API logs", () => {
  test("no host token is in the server's log", async () => {
    const logs: Array<string> = []
    const logged = makeApp(undefined, { logs })
    const now = Math.floor(Date.now() / 1000)
    const tokens = await Effect.runPromise(
      Effect.all([
        hostToken(Brain.ID.create(), Auth.OrganizationID.create()),
        hostToken(Brain.ID.create(), Auth.OrganizationID.create(), { exp: now - 120 }),
      ]),
    )
    await Promise.all(
      ["/host/token/refresh", "/host/models/refresh", "/host/pull"].flatMap((path) =>
        [...tokens, "not-a-token"].map((token) =>
          logged.handler(
            new Request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${token}` } }),
          ),
        ),
      ),
    )
    await logged.dispose()
    expect(logs.length).toBeGreaterThan(0)
    expect(tokens.filter((token) => logs.some((line) => line.includes(token)))).toEqual([])
  })
})
