import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { ChannelInstall } from "@ren/schema/channel-install"
import type { Session as SessionSchema } from "@ren/schema/session"
import { Task } from "@ren/schema/task"
import { TaskLink } from "@ren/schema/task-link"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Fiber, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { GitHubApp } from "../src/github-app.js"
import { Session } from "../src/session.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { GitHubServer } from "./lib/github-server.js"
import { Seed } from "./lib/seed.js"

const github = GitHubServer.start()
afterAll(() => github.stop())

const it = testEffect(
  Configured.sessionLayerWith(
    GitHubApp.layer.pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(
        ConfigProvider.layerAdd(
          ConfigProvider.fromUnknown(GitHubServer.config(github.url, { GITHUB_URL: "https://github.com" })),
        ),
      ),
    ),
  ),
)

const chatWithTask = Effect.fnUntraced(function* (urls: ReadonlyArray<string>) {
  const database = yield* Database.Service
  const owner = yield* Seed.owner()
  const id = yield* Seed.session(owner)
  const installation = String(Math.floor(Math.random() * 1e9))
  github.installations.set(installation, "acme")
  yield* database.db.insert(Database.Schema.channel_install).values({
    id: ChannelInstall.ID.create(),
    organization_id: owner.organizationId,
    provider: "github",
    workspace: installation,
    name: "acme",
    installed_by: owner.createdBy,
  })
  yield* database.db
    .insert(Database.Schema.task_sequence)
    .values({ organization_id: owner.organizationId, prefix: "ACME", last_number: 1 })
  const created = Effect.fnUntraced(function* (sessionId: SessionSchema.ID) {
    const taskId = Task.ID.create()
    yield* database.db.insert(Database.Schema.task).values({
      id: taskId,
      organization_id: owner.organizationId,
      space_id: owner.spaceId,
      number: 1,
      title: "Fix login",
      created_by_session_id: sessionId,
    })
    yield* database.db.insert(Database.Schema.task_link).values(
      urls.map((url) => ({
        id: TaskLink.ID.create(),
        task_id: taskId,
        organization_id: owner.organizationId,
        ...TaskLink.classify(url),
        url,
      })),
    )
    return taskId
  })
  return {
    owner,
    id,
    created,
    actor: { userId: owner.createdBy, organizationId: owner.organizationId, roles: ["owner"] },
  }
})

describe("Session links", () => {
  it.live("links answer while GitHub holds its answer, and pullRequests add the state once GitHub answers", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const repository = `acme/web-${crypto.randomUUID().slice(0, 8)}`
      const url = `https://github.com/${repository}/pull/41`
      const chat = yield* chatWithTask([url])
      yield* chat.created(chat.id)
      github.resources.set(`/repos/${repository}/pulls/41`, {
        title: "Stop the login loop",
        state: "closed",
        merged: true,
        head: { ref: "fix-login" },
        base: { ref: "main" },
      })
      const release = Promise.withResolvers<void>()
      github.options.held = release.promise
      const states = yield* sessions.pullRequests(chat.actor, chat.id).pipe(Effect.forkScoped)
      expect((yield* sessions.links(chat.actor, chat.id)).pullRequests).toEqual([{ url, number: 41 }])
      github.options.held = undefined
      release.resolve()
      expect(yield* Fiber.join(states)).toEqual([{ url, number: 41, title: "Stop the login loop", state: "merged" }])
    }),
  )

  it.live("a subagent's chat lists its own links, read through its root chat", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sessions = yield* Session.Service
      const url = "https://github.com/acme/web/issues/30"
      const chat = yield* chatWithTask([url])
      const child = yield* Seed.session(chat.owner)
      yield* database.db
        .update(Database.Schema.agent_session)
        .set({ parent_id: chat.id, root_id: chat.id })
        .where(eq(Database.Schema.agent_session.id, child))
      const taskId = yield* chat.created(child)
      const links = yield* sessions.links(chat.actor, child)
      expect(links.tasks.map((task) => task.id)).toEqual([taskId])
      expect(links.issues).toEqual([{ kind: "github_issue", url }])
      expect((yield* sessions.links(chat.actor, chat.id)).tasks).toEqual([])
      const stranger = yield* Seed.owner()
      expect(
        (yield* Effect.flip(
          sessions.links(
            { userId: stranger.createdBy, organizationId: chat.owner.organizationId, roles: ["member"] },
            child,
          ),
        ))._tag,
      ).toBe("Primitive.NotFound")
    }),
  )
})
