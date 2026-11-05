import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ConfigProvider, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { GitHubApp } from "../src/github-app.js"
import { GitHubTaskCard } from "../src/github-task-card.js"
import { SlackTaskCard } from "../src/slack-task-card.js"
import { Task } from "../src/task.js"
import { TaskCard } from "../src/task-card.js"
import { GitHubServer } from "./lib/github-server.js"
import { Seed } from "./lib/seed.js"
import { TaskFixture } from "./lib/task-fixture.js"

const github = GitHubServer.start()
afterAll(() => github.stop())

const app = "https://ren.test/app"

const it = TaskFixture.harness(
  TaskCard.layer.pipe(
    Layer.provide(SlackTaskCard.layerNone),
    Layer.provide(GitHubTaskCard.layer),
    Layer.provide(GitHubApp.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown({
          ...GitHubServer.config(github.url, { GITHUB_URL: "https://github.com" }),
          APP_URL: app,
        }),
      ),
    ),
  ),
).it

const installed = Effect.fnUntraced(function* (o: Effect.Success<typeof TaskFixture.org>) {
  const database = yield* Database.Service
  const installation = String(Math.floor(Math.random() * 1e9))
  github.installations.set(installation, "acme")
  yield* database.db.insert(Database.Schema.channel_install).values({
    id: ChannelInstall.ID.create(),
    organization_id: o.organizationId,
    provider: "github",
    workspace: installation,
    name: "acme",
    installed_by: o.ada.userId,
  })
})

const writes = () => github.posted.length + github.patched.length

describe("GitHubTaskCard", () => {
  it.live("a task change posts one comment on each linked pull request, and the next change edits it", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* TaskFixture.org
      yield* installed(o)
      const build = yield* o.agentIn(o.ada, o.factory.id)
      const repository = `acme/web-${crypto.randomUUID().slice(0, 8)}`
      const before = writes()
      const created = yield* tasks.create(build, {
        spaceId: o.factory.id,
        title: "Fix the <deploy>",
        links: [`https://github.com/${repository}/pull/41`],
      })
      yield* Effect.promise(() => github.written(before + 1))
      const comments = `/repos/${repository}/issues/41/comments`
      expect(github.posted.filter((post) => post.path === comments).map((post) => post.body)).toEqual([
        {
          body: [
            `<!-- ren:task ${created.id} -->`,
            `**[${created.identifier}](${app}/tasks/${created.identifier})** Fix the &lt;deploy&gt;`,
            "**Status:** To do · **Agent:** none",
            [
              "| Phase | Session |",
              "| --- | --- |",
              `| build | [${build.agent.sessionId}](${app}/sessions/${build.agent.sessionId}) |`,
            ].join("\n"),
          ].join("\n\n"),
        },
      ])
      yield* tasks.update(o.ada, created.id, { status: "in_progress" })
      yield* Effect.promise(() => github.written(before + 2))
      const id = github.comments.get(comments)?.at(0)?.id
      expect(github.posted.filter((post) => post.path === comments)).toHaveLength(1)
      expect(github.patched.at(-1)).toMatchObject({
        path: `/repos/${repository}/issues/comments/${id}`,
        body: { body: expect.stringContaining("**Status:** In progress") },
      })
    }),
  )

  it.live("a parent that moves to another space edits the comments of the subtasks whose agent it clears", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* TaskFixture.org
      yield* installed(o)
      yield* Seed.join(o.eng.id, o.ada.userId)
      const repository = `acme/web-${crypto.randomUUID().slice(0, 8)}`
      const parent = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Ship SSO" })
      const before = writes()
      yield* tasks.create(o.ada, {
        spaceId: o.factory.id,
        parentId: parent.id,
        title: "Add the login page",
        agentId: yield* o.agent("build"),
        links: [`https://github.com/${repository}/issues/7`],
      })
      yield* Effect.promise(() => github.written(before + 1))
      expect(github.posted.at(-1)?.body).toEqual({ body: expect.stringContaining("**Agent:** build") })
      yield* tasks.assign(o.ada, parent.id, { spaceId: o.eng.id, start: "none" })
      yield* Effect.promise(() => github.written(before + 2))
      expect(github.patched.at(-1)).toMatchObject({
        path: `/repos/${repository}/issues/comments/${github.comments.get(`/repos/${repository}/issues/7/comments`)?.at(0)?.id}`,
        body: { body: expect.stringContaining("**Agent:** none") },
      })
    }),
  )
})
