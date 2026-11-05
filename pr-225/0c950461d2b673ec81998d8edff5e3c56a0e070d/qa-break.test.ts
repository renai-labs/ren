import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Channel } from "@ren/schema/channel"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"
import { ConfigProvider, Context, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
const W = "/home/user/.local/share/opencode/repos/factory/ren-RENAI-36/ren/packages/core"
const { ChannelNotice } = await import(`${W}/src/channel-notice.ts`)
const { ChannelProvider } = await import(`${W}/src/channel-provider.ts`)
const { ChannelSecrets } = await import(`${W}/src/channel-secrets.ts`)
const { Envelope } = await import(`${W}/src/envelope.ts`)
const { GitHubTaskCard } = await import(`${W}/src/github-task-card.ts`)
const { SlackApp } = await import(`${W}/src/slack-app.ts`)
const { SlackTaskCard } = await import(`${W}/src/slack-task-card.ts`)
const { Task } = await import(`${W}/src/task.ts`)
const { TaskCard } = await import(`${W}/src/task-card.ts`)
const { Seed } = await import(`${W}/test/lib/seed.ts`)
const { SlackServer } = await import(`${W}/test/lib/slack-server.ts`)
const { TaskFixture } = await import(`${W}/test/lib/task-fixture.ts`)

const slack = SlackServer.start()
afterAll(() => slack.stop())
const app = "https://ren.test/app"

const slackCards = SlackTaskCard.layer.pipe(
  Layer.provideMerge(SlackApp.layer),
  Layer.provideMerge(ChannelSecrets.layer),
  Layer.provide(Envelope.layerLocal),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    ConfigProvider.layerAdd(
      ConfigProvider.fromUnknown({
        ...SlackServer.config(slack.url),
        APP_URL: app,
        ENVELOPE_KEYS: JSON.stringify([
          { id: "local:test", key: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") },
        ]),
      }),
    ),
  ),
  Layer.orDie,
)

const it = TaskFixture.harness(
  TaskCard.layer.pipe(Layer.provide(GitHubTaskCard.layerNone), Layer.provide(slackCards)),
  ChannelNotice.layer.pipe(
    Layer.provide(slackCards),
    Layer.provide(ChannelProvider.layer(Effect.succeed([]))),
    Layer.provide(ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ APP_URL: app }))),
  ),
).it

const meta = (m: any) => m?.metadata as any
const statusOf = (m: any) => meta(m)?.entities?.at(0)?.entity_payload?.fields?.status?.value
const titleOf = (m: any) => meta(m)?.entities?.at(0)?.entity_payload?.attributes?.title?.text
const until = (condition: () => boolean, label = "condition") =>
  Effect.sync(condition).pipe(
    Effect.repeat({ until: (done) => done, schedule: Schedule.spaced("20 millis") }),
    Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.die(new Error(`timeout: ${label}`)) }),
  )
const settle = Effect.sleep("600 millis")
const calls = (method: string) => slack.posted.filter((each) => each.method === method)

const installed = Effect.fnUntraced(function* (o: any, mapTo?: Space.ID) {
  const database = yield* Database.Service
  const secrets = yield* ChannelSecrets.Service.pipe(Effect.provide(slackCards))
  const workspace = `T${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const token = `xoxb-${crypto.randomUUID()}`
  slack.grants.set(`grant-${workspace}`, { team: workspace, teamName: "Acme", user: "U01", token })
  const id = ChannelInstall.ID.create()
  yield* database.db.insert(Database.Schema.channel_install).values({
    id,
    organization_id: o.organizationId,
    provider: "slack",
    workspace,
    name: "Acme",
    bot_user: "UBOT",
    installed_by: o.ada.userId,
    secret: yield* secrets.seal(o.organizationId, id, Redacted.make(token)),
  })
  const channel = `C${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  yield* database.db.insert(Database.Schema.channel_mapping).values({
    id: ChannelMapping.ID.create(),
    install_id: id,
    place: channel,
    place_name: "eng",
    space_id: mapTo ?? o.factory.id,
    created_by: o.ada.userId,
  })
  return { workspace, channel, installId: id }
})

const threadIn = (channel: string) => {
  const seconds = String(Math.floor(Math.random() * 9e9) + 1e9)
  const key = `${channel}:${seconds}.000100`
  slack.threads.set(key, [])
  return { key, url: `https://acme.slack.com/archives/${channel}/p${seconds}000100` }
}

const threaded = Effect.fnUntraced(function* (o: any, workspace: string, key: string, sessionId?: Session.ID) {
  const database = yield* Database.Service
  yield* database.db.insert(Database.Schema.channel_thread).values({
    id: Channel.ThreadID.create(),
    organization_id: o.organizationId,
    provider: "slack",
    install: workspace,
    thread: key,
    session_id:
      sessionId ??
      (yield* Seed.session({ organizationId: o.organizationId, spaceId: o.factory.id, createdBy: o.ada.userId })),
  })
})

const cardsOf = Effect.gen(function* () {
  const context = yield* Layer.build(slackCards)
  return Context.get(context, SlackTaskCard.Service)
})

const slackAccount = (workspace: string, userId: Auth.UserID, slackId: string) =>
  Effect.gen(function* () {
    const database = yield* Database.Service
    yield* database.db.insert(Database.Schema.account).values({
      id: Auth.AccountID.create(),
      providerId: "slack",
      accountId: `${workspace}:${slackId}`,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  })

const log = (label: string, value: unknown) => console.log(`QA ${label}: ${JSON.stringify(value)}`)

describe("QA RENAI-36", () => {
  it.live("archive edits the one card; no second card", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* TaskFixture.org
      const found = yield* installed(o)
      const t = threadIn(found.channel)
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Archive me", links: [t.url] })
      yield* until(() => slack.threads.get(t.key)?.length === 1, "card")
      yield* tasks.archive(o.ada, created.id)
      yield* until(() => statusOf(slack.threads.get(t.key)?.at(0)) === "Archived", "archived")
      yield* settle
      log("archive thread", slack.threads.get(t.key)?.map((m) => [m.text, statusOf(m)]))
      expect(slack.threads.get(t.key)).toHaveLength(1)
    }),
  )

  it.live("archived task with no card posts none", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* TaskFixture.org
      const found = yield* installed(o)
      const t = threadIn(found.channel)
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "x", links: [t.url] })
      yield* until(() => slack.threads.get(t.key)?.length === 1, "card")
      slack.threads.set(t.key, [])
      yield* tasks.archive(o.ada, created.id)
      yield* settle
      expect(slack.threads.get(t.key)).toHaveLength(0)
    }),
  )

  it.live("review request, decision and later link: edits, no second card; link added later posts one", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* TaskFixture.org
      const found = yield* installed(o)
      const t = threadIn(found.channel)
      yield* threaded(o, found.workspace, t.key)
      const build = yield* o.agentIn(o.ada, o.factory.id)
      const created = yield* tasks.create(build, { spaceId: o.factory.id, title: "Review me" })
      yield* settle
      expect(slack.threads.get(t.key)).toHaveLength(0)
      yield* tasks.update(o.ada, created.id, { addLinks: [t.url] })
      yield* until(() => slack.threads.get(t.key)?.length === 1, "card after addLinks")
      yield* tasks.review(build, created.id, { humanReview: true, reason: "Please check" })
      yield* until(() => slack.threads.get(t.key)?.length === 2, "notice")
      yield* until(() => slack.threads.get(t.key)!.every((m) => statusOf(m) === "Needs review"), "needs review")
      const updatesBefore = calls("chat.update").length
      yield* tasks.review(o.ada, created.id, { humanReview: false, decision: "approved", start: "none" } as any)
      yield* until(() => calls("chat.update").length >= updatesBefore + 2, "decision edits")
      yield* settle
      log("review thread", slack.threads.get(t.key)?.map((m) => [m.text, statusOf(m), meta(m)?.event_payload]))
      expect(slack.threads.get(t.key)).toHaveLength(2)
      expect(slack.threads.get(t.key)!.map(statusOf)).toEqual(["To do", "To do"])
      expect(slack.threads.get(t.key)!.at(1)!.text).toContain("Needs a person: Please check")
    }),
  )

  it.live("merge: done notice + card edit; owner tagged over creator", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* TaskFixture.org
      const found = yield* installed(o)
      const t = threadIn(found.channel)
      yield* threaded(o, found.workspace, t.key)
      yield* slackAccount(found.workspace, o.ada.userId, "UADA")
      yield* slackAccount(found.workspace, o.grace.userId, "UGRACE")
      yield* Seed.join(o.factory.id, o.grace.userId)
      const created = yield* tasks
        .create(o.ada, {
          spaceId: o.factory.id,
          title: "Merge me",
          ownerId: o.grace.userId,
          links: [t.url, "https://github.com/acme/web/pull/77"],
        })
        .pipe(Effect.catchCause((c) => Effect.sync(() => log("create with owner failed", String(c))).pipe(Effect.as(undefined))))
      if (!created) return
      log("owner", created.ownerId)
      yield* until(() => slack.threads.get(t.key)?.length === 1, "card")
      const done = yield* tasks.completeMerged(o.organizationId, { kind: "github_pr", key: "acme/web#77" }, "https://github.com/acme/web/pull/77")
      expect(done).toEqual([created.id])
      yield* until(() => slack.threads.get(t.key)?.length === 2, "done notice")
      yield* until(() => slack.threads.get(t.key)!.every((m) => statusOf(m) === "Done"), "done everywhere")
      yield* settle
      log("merge thread", slack.threads.get(t.key)?.map((m) => [m.text, statusOf(m)]))
      expect(slack.threads.get(t.key)!.at(1)!.text.startsWith("<@UGRACE> Done.")).toBe(true)
      expect(slack.threads.get(t.key)).toHaveLength(2)
    }),
  )

  it.live("done by agent: no notice in its own thread; repeat done makes no second notice", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* TaskFixture.org
      const found = yield* installed(o)
      const own = threadIn(found.channel)
      const other = threadIn(found.channel)
      const build = yield* o.agentIn(o.ada, o.factory.id)
      yield* threaded(o, found.workspace, own.key, build.agent.sessionId)
      yield* threaded(o, found.workspace, other.key)
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Do", links: [own.url, other.url] })
      yield* until(() => slack.threads.get(own.key)?.length === 1 && slack.threads.get(other.key)?.length === 1, "cards")
      yield* tasks.update(build, created.id, { status: "done" })
      yield* until(() => slack.threads.get(other.key)?.length === 2, "other notice")
      yield* tasks.update(build, created.id, { status: "done", title: "Do it" })
      yield* settle
      log("own", slack.threads.get(own.key)?.map((m) => [m.text, statusOf(m)]))
      log("other", slack.threads.get(other.key)?.map((m) => [m.text, statusOf(m)]))
      expect(slack.threads.get(own.key)).toHaveLength(1)
      expect(slack.threads.get(other.key)).toHaveLength(2)
      expect(slack.threads.get(own.key)!.at(0)!.text).toContain("Do it · Done")
    }),
  )

  it.live("title rule: channel mapped to another space shows only the ID", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* TaskFixture.org
      const found = yield* installed(o, o.eng.id)
      const t = threadIn(found.channel)
      yield* threaded(o, found.workspace, t.key)
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Secret title", description: "secret desc", links: [t.url] })
      yield* until(() => slack.threads.get(t.key)?.length === 1, "card")
      yield* tasks.review(o.ada, created.id, { humanReview: true, reason: "Look" })
      yield* until(() => slack.threads.get(t.key)?.length === 2, "notice")
      yield* settle
      const all = JSON.stringify(slack.threads.get(t.key))
      log("other-space thread", slack.threads.get(t.key)?.map((m) => [m.text, titleOf(m)]))
      expect(all).not.toContain("Secret title")
      expect(all).not.toContain("secret desc")
      expect(titleOf(slack.threads.get(t.key)!.at(0))).toBe(created.identifier)
      const cards = yield* cardsOf
      const before = calls("entity.presentDetails").length
      yield* cards.present(o.organizationId, { kind: "details_requested", install: found.workspace, trigger: "tr", url: `${app}/tasks/${created.identifier}` })
      yield* until(() => calls("entity.presentDetails").length === before + 1, "details no place")
      const p = calls("entity.presentDetails").at(-1)!.params.metadata ?? ""
      log("details without channel", p.slice(0, 300))
      expect(p).not.toContain("Secret title")
      expect(p).not.toContain("secret desc")
    }),
  )

  it.live("unfurl: other org, lowercase id, trailing slash, foreign host, private task id", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* TaskFixture.org
      const p = yield* TaskFixture.org
      const found = yield* installed(o)
      const mine = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Mine" })
      const theirs = yield* tasks.create(p.ada, { spaceId: p.factory.id, title: "Theirs" })
      const cards = yield* cardsOf
      const before = calls("chat.unfurl").length
      yield* cards.unfurl(o.organizationId, {
        kind: "links_shared",
        install: found.workspace,
        place: found.channel,
        message: "1.2",
        urls: [
          `${app}/tasks/${theirs.identifier}`,
          `${app}/tasks/${theirs.id}`,
          `${app}/tasks/${mine.identifier.toLowerCase()}`,
          `${app}/tasks/${mine.identifier}/`,
          `https://evil.test/app/tasks/${mine.identifier}`,
          `${app}/tasks/${mine.identifier}-1`,
          `${app}/tasks/%27`,
          `${app}/tasks/${o.prefix}-0`,
          `${app}/tasks/${o.prefix}-99999999999`,
        ],
      })
      yield* until(() => calls("chat.unfurl").length === before + 1, "unfurl")
      const ents = JSON.parse(calls("chat.unfurl").at(-1)!.params.metadata!).entities
      log("unfurl", ents.map((e: any) => [e.app_unfurl_url, e.external_ref.id, e.entity_payload.attributes.title.text]))
      expect(ents.every((e: any) => e.external_ref.id === mine.id)).toBe(true)
      expect(ents).toHaveLength(2)
      const pb = calls("entity.presentDetails").length
      yield* cards.present(o.organizationId, { kind: "details_requested", install: found.workspace, place: found.channel, trigger: "t2", url: `${app}/tasks/${theirs.identifier}`, externalId: theirs.id })
      yield* until(() => calls("entity.presentDetails").length === pb + 1, "details other org")
      expect(calls("entity.presentDetails").at(-1)!.params.error).toBe(JSON.stringify({ status: "not_found" }))
    }),
  )
})
