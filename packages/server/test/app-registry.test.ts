import { expect } from "bun:test"
import { BunHttpServer } from "@effect/platform-bun"
import { Access } from "@ren/core/access"
import { AppRegistry } from "@ren/core/app/registry"
import { testEffect } from "@ren/core/testing"
import { Testing } from "@ren/db/testing"
import { Effect, Layer, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import { Routes } from "../src/routes.js"
import { config, environment, services } from "./lib/app.js"

const it = testEffect(
  Layer.mergeAll(
    HttpRouter.serve(Routes.layer, { disableListenLog: true, disableLogger: true }).pipe(
      Layer.provide(services),
      Layer.provide(FetchHttpClient.layer),
    ),
    AppRegistry.layer.pipe(Layer.provide(Access.layer)),
  ).pipe(Layer.provideMerge(BunHttpServer.layerTest), Layer.provideMerge(Testing.layer), Layer.provide(environment())),
)

const request = Effect.fnUntraced(function* (
  method: "GET" | "POST" | "PATCH",
  path: string,
  cookie: string,
  body?: unknown,
) {
  const http = yield* HttpClient.HttpClient
  const response = yield* http.execute(
    HttpClientRequest.make(method)(path).pipe(
      HttpClientRequest.setHeaders({ cookie, origin: config.BETTER_AUTH_URL }),
      body === undefined ? (request) => request : HttpClientRequest.bodyJsonUnsafe(body),
    ),
  )
  return {
    status: response.status,
    cookie: response.headers["set-cookie"] ?? "",
    body: yield* response.json.pipe(Effect.orElseSucceed(() => null)),
  }
})

const Page = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct({ items: Schema.Array(Schema.Struct(fields)) })

it.live("members browse listed apps and install them, but app routes cannot publish or change a listing", () =>
  Effect.gen(function* () {
    const registry = yield* AppRegistry.Service
    const published = yield* registry.publish(
      Schema.decodeUnknownSync(AppRegistry.Batch)({
        apps: [
          {
            slug: "context7",
            name: "Context7",
            description: "Docs for libraries",
            mcps: {
              context7: {
                name: "Context7",
                description: "Docs",
                transport: { type: "remote", url: "https://mcp.context7.com/mcp" },
                auth: { type: "none" },
              },
            },
            listing: { body: "Library docs" },
          },
          { slug: "unlisted", name: "Unlisted", description: "Not in the registry" },
        ],
      }),
    )
    const listed = published.apps.at(0)
    expect((yield* request("GET", "/app-registry", "")).status).toBe(401)
    const signedUp = yield* request("POST", "/auth/sign-up/email", "", {
      email: "registry-reader@gmail.com",
      password: "correct horse battery staple",
      name: "Ada",
    })
    const cookie = signedUp.cookie
      .split(/,(?=\s*[^;,=\s]+=)/u)
      .map((entry) => entry.split(";").at(0)?.trim())
      .join("; ")
    const browse = yield* request("GET", "/app-registry?query=docs", cookie)
    expect(browse.status).toBe(200)
    expect(Schema.decodeUnknownSync(Page({ slug: Schema.String }))(browse.body).items.map((item) => item.slug)).toEqual(
      ["context7"],
    )
    expect((yield* request("GET", "/app-registry/context7", cookie)).body).toMatchObject({
      id: listed?.appId,
      listing: { body: "Library docs" },
      revision: 1,
    })
    expect((yield* request("GET", "/app-registry/unlisted", cookie)).status).toBe(404)
    expect(
      (yield* request("PATCH", `/apps/${listed?.appId}`, cookie, { name: "Mine", expectedRevision: 1 })).status,
    ).toBe(403)
    const spaces = Schema.decodeUnknownSync(Page({ id: Schema.String }))(
      (yield* request("GET", "/spaces", cookie)).body,
    )
    const spaceId = spaces.items.at(0)?.id
    const created = yield* request("POST", "/apps", cookie, {
      slug: "custom",
      ownerSpaceId: spaceId,
      name: "Custom",
      description: "Mine",
    })
    expect(created.status).toBe(200)
    expect((yield* request("GET", "/app-registry/custom", cookie)).status).toBe(404)
    const profile = yield* request("POST", "/app-profiles", cookie, {
      appId: listed?.appId,
      name: "Docs",
      slug: "docs",
      kind: "shared",
      spaceIds: [spaceId],
    })
    expect(profile.status).toBe(200)
  }),
)
