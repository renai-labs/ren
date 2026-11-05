import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ConfigProvider, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { GitHubApp } from "../src/github-app.js"
import { PullRequest } from "../src/pull-request.js"
import { Task } from "../src/task.js"
import { GitHubServer } from "./lib/github-server.js"
import { TaskFixture } from "./lib/task-fixture.js"

const github = GitHubServer.start()
afterAll(() => github.stop())

const it = TaskFixture.harness(
  undefined,
  undefined,
  PullRequest.layer.pipe(
    Layer.provide(GitHubApp.layer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown(GitHubServer.config(github.url, { GITHUB_URL: "https://github.com" })),
      ),
    ),
  ),
).it

const title = "Stop the login loop"

const pull = (fields: Record<string, unknown>) => ({
  title,
  state: "open",
  head: { ref: "fix-login" },
  base: { ref: "main" },
  ...fields,
})

describe("PullRequest", () => {
  it.live("a task's pull requests show GitHub's title and state, and null for one GitHub does not show", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const tasks = yield* Task.Service
      const o = yield* TaskFixture.org
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
      const repository = `acme/web-${crypto.randomUUID().slice(0, 8)}`
      github.resources.set(`/repos/${repository}/pulls/1`, pull({}))
      github.resources.set(`/repos/${repository}/pulls/2`, pull({ draft: true }))
      github.resources.set(`/repos/${repository}/pulls/3`, pull({ state: "closed", merged: true }))
      github.resources.set(`/repos/${repository}/pulls/4`, pull({ state: "closed", merged: false }))
      const url = (number: number) => `https://github.com/${repository}/pull/${number}`
      const task = yield* tasks.create(o.ada, {
        spaceId: o.factory.id,
        title: "Fix login",
        links: [url(1), `https://github.com/${repository}/issues/9`, url(2), url(3), url(4), url(5)],
      })
      expect(yield* tasks.pullRequests(o.ada, task.id)).toEqual([
        { url: url(1), number: 1, title, state: "open" },
        { url: url(2), number: 2, title, state: "draft" },
        { url: url(3), number: 3, title, state: "merged" },
        { url: url(4), number: 4, title, state: "closed" },
        { url: url(5), number: 5, title: null, state: null },
      ])
      expect((yield* Effect.flip(tasks.pullRequests(o.grace, task.id)))._tag).toBe("Primitive.NotFound")
    }),
  )
})
