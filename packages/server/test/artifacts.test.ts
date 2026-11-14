import { expect } from "bun:test"
import { ArtifactWorkerd } from "@ren/core/artifact-provider/workerd"
import { testEffect } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { Artifact } from "@ren/schema/artifact"
import { ApiFixture } from "@ren/server/testing/api"
import { Effect } from "effect"

const it = testEffect(ApiFixture.layer)

it.live(
  "members list, show and archive a space's artifacts over HTTP, and one they cannot see or have archived is a 404",
  () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const owner = yield* ApiFixture.owner()
      const stranger = yield* ApiFixture.owner()
      const id = Artifact.ID.make(`art_${crypto.randomUUID().replaceAll("-", "")}`)
      yield* database.db.insert(Database.Schema.artifact).values({
        id,
        organization_id: owner.organizationId,
        space_id: owner.spaceId,
        title: "Orders",
        provider: ArtifactWorkerd.id,
        config: { entry: "index.html" },
      })
      const json = (response: Response) => Effect.promise<unknown>(() => response.json())
      const listed = yield* owner.request("GET", `/artifacts?spaceId=${owner.spaceId}`)
      expect([listed.status, yield* json(listed)]).toEqual([200, expect.objectContaining({ total: 1 })])
      const shown = yield* owner.request("GET", `/artifacts/${id}`)
      expect([shown.status, yield* json(shown)]).toEqual([
        200,
        expect.objectContaining({ id, title: "Orders", entry: "index.html", url: null, archivedAt: null }),
      ])
      expect((yield* stranger.request("GET", `/artifacts/${id}`)).status).toBe(404)
      const archived = yield* owner.request("DELETE", `/artifacts/${id}`)
      expect([archived.status, yield* json(archived)]).toEqual([
        200,
        expect.objectContaining({ id, archivedAt: expect.any(String) }),
      ])
      expect((yield* owner.request("GET", `/artifacts/${id}`)).status).toBe(404)
    }),
)

it.live(
  "a v1 share link redirects anyone to the same path of its artifact's page, and an unknown or archived one is a 404",
  () =>
    Effect.gen(function* () {
      const api = yield* ApiFixture.Service
      const database = yield* Database.Service
      const owner = yield* ApiFixture.owner()
      const id = Artifact.ID.make(`art_${crypto.randomUUID().replaceAll("-", "")}`)
      yield* database.db.insert(Database.Schema.artifact).values({
        id,
        organization_id: owner.organizationId,
        space_id: owner.spaceId,
        title: "Orders",
        provider: ArtifactWorkerd.id,
        url: "https://art-orders.useren.site/",
      })
      yield* database.db
        .insert(Database.Schema.artifact_share_link)
        .values({ token: "shr_Orders-1_x", artifact_id: id })
      const get = (path: string) =>
        Effect.promise(() => api.handler(new Request(`http://localhost:4000${path}`, { redirect: "manual" })))
      const location = (path: string) =>
        get(path).pipe(Effect.map((response) => [response.status, response.headers.get("location")]))
      expect(yield* location("/a/shr_Orders-1_x")).toEqual([302, "https://art-orders.useren.site/"])
      expect(yield* location("/a/shr_Orders-1_x/")).toEqual([302, "https://art-orders.useren.site/"])
      expect(yield* location("/a/shr_Orders-1_x/week/2.html?team=a")).toEqual([
        302,
        "https://art-orders.useren.site/week/2.html?team=a",
      ])
      expect(yield* location("/a/shr_Orders-1_x//evil.example/x")).toEqual([
        302,
        "https://art-orders.useren.site//evil.example/x",
      ])
      expect((yield* get("/a/shr_unknown/")).status).toBe(404)
      yield* owner.request("DELETE", `/artifacts/${id}`)
      expect((yield* get("/a/shr_Orders-1_x/")).status).toBe(404)
    }),
)
