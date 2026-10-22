import { expect } from "bun:test"
import { Seed } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { RenHostApi } from "@ren/host-api/ren-host-api"
import { SessionToken } from "@ren/host-api/session-token"
import { Task } from "@ren/schema/task"
import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpServer } from "effect/http"
import { HttpApiClient } from "effect/http-api"
import { cellKey } from "./lib/app.js"
import { SyncTest } from "./lib/sync.js"

SyncTest.live("host task tools attribute writes to the session and cannot reach another space", () =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* Seed.ren()
    const owner = yield* Seed.owner()
    yield* Seed.member(owner.organizationId, owner.createdBy, "admin")
    const sessionId = yield* Seed.session(owner)
    const secondSpace = yield* Seed.space(owner.organizationId)
    const secondSession = yield* Seed.session({ ...owner, spaceId: secondSpace })
    const server = yield* HttpServer.HttpServer
    const baseUrl = HttpServer.formatAddress(server.address)
    const token = yield* SessionToken.sign(cellKey, {
      sid: sessionId,
      scope: "host",
      org: owner.organizationId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    })
    const secondToken = yield* SessionToken.sign(cellKey, {
      sid: secondSession,
      scope: "host",
      org: owner.organizationId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
    })
    const http = yield* HttpClient.HttpClient
    const client = yield* HttpApiClient.makeWith(RenHostApi, {
      baseUrl,
      httpClient: HttpClient.mapRequest(http, HttpClientRequest.bearerToken(token)),
    })
    const other = yield* HttpApiClient.makeWith(RenHostApi, {
      baseUrl,
      httpClient: HttpClient.mapRequest(http, HttpClientRequest.bearerToken(secondToken)),
    })
    const created = yield* client.tasks.task_create({ payload: { title: "Host task" } })
    expect(created).toMatchObject({ spaceId: owner.spaceId, createdBy: { userId: owner.createdBy, sessionId } })
    expect(created.createdBy.agentId).not.toBeNull()
    const linked = yield* database.db
      .select()
      .from(Database.Schema.task_session)
      .where(
        and(
          eq(Database.Schema.task_session.task_id, created.id),
          eq(Database.Schema.task_session.session_id, sessionId),
        ),
      )
    expect(linked).toHaveLength(1)
    expect(
      (yield* client.tasks.task_list({ payload: { page: 1, pageSize: 50 } })).items.map((task) => task.id),
    ).toEqual([created.id])
    expect((yield* other.tasks.task_list({ payload: { page: 1, pageSize: 50 } })).items).toEqual([])
    expect(
      (yield* Effect.flip(other.tasks.task_get({ payload: { id: created.id, page: 1, pageSize: 50 } })))._tag,
    ).toBe("TaskNotFoundError")
    expect(
      (yield* Effect.flip(other.tasks.task_comment({ payload: { taskId: created.id, body: "Outside" } })))._tag,
    ).toBe("TaskNotFoundError")
    const comment = yield* client.tasks.task_comment({ payload: { taskId: created.id, body: "Review this" } })
    expect(comment.author).toEqual(created.createdBy)
    yield* client.tasks.task_review({ payload: { id: created.id, reason: "Approval" } })
    const read = yield* client.tasks.task_get({ payload: { id: created.identifier, page: 1, pageSize: 50 } })
    expect(read.task.humanReview).toBe(true)
    expect(read.activity.items.some((item) => item.type === "comment")).toBe(true)
    const refused = yield* Effect.promise(() =>
      fetch(`${baseUrl}/host/tasks/update`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ id: created.id, status: "done" satisfies Task.Status }),
      }),
    )
    expect(refused.status).toBe(400)
    const move = yield* Effect.promise(() =>
      fetch(`${baseUrl}/host/tasks/assign`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ id: created.id, agentId: null, spaceId: secondSpace }),
      }),
    )
    expect(move.status).toBe(400)
  }).pipe(Effect.provide(FetchHttpClient.layer)),
)
