import { afterAll, describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Channel } from "@ren/schema/channel"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import type { Session } from "@ren/schema/session"
import { eq } from "drizzle-orm"
import { ConfigProvider, Context, Effect, Layer, Option, Redacted, Schedule, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { ChannelIdentity } from "../src/channel-identity.js"
import { ChannelNotice } from "../src/channel-notice.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { Slack } from "../src/channel-provider/slack.js"
import { ChannelRoute } from "../src/channel-route.js"
import { ChannelSecrets } from "../src/channel-secrets.js"
import { Envelope } from "../src/envelope.js"
import { GitHubTaskCard } from "../src/github-task-card.js"
import { SlackApp } from "../src/slack-app.js"
import { SlackTaskActions } from "../src/slack-task-actions.js"
import { SlackTaskCard } from "../src/slack-task-card.js"
import { Task } from "../src/task.js"
import { TaskCard } from "../src/task-card.js"
import { Seed } from "./lib/seed.js"
import { SlackServer } from "./lib/slack-server.js"
import { TaskFixture } from "./lib/task-fixture.js"

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

const Button = Schema.Struct({ text: Schema.String, url: Schema.optionalKey(Schema.String) })

const Entity = Schema.Struct({
  external_ref: Schema.Struct({ id: Schema.String }),
  entity_payload: Schema.Struct({
    attributes: Schema.Struct({ title: Schema.Struct({ text: Schema.String }) }),
    fields: Schema.Record(Schema.String, Schema.Struct({ value: Schema.Unknown })),
    custom_fields: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.Unknown })),
    actions: Schema.optionalKey(
      Schema.Struct({
        primary_actions: Schema.optionalKey(Schema.Array(Button)),
        overflow_actions: Schema.optionalKey(Schema.Array(Button)),
      }),
    ),
  }),
})
type Entity = typeof Entity.Type

const Metadata = Schema.Struct({
  event_payload: Schema.Struct({ task_id: Schema.String, kind: Schema.String }),
  entities: Schema.Array(Entity),
})

const metadataOf = (message: SlackServer.Posted | undefined) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Metadata)(message?.metadata))

const entityIn = Schema.decodeUnknownSync(Schema.fromJsonString(Entity))

const entitiesIn = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ entities: Schema.Array(Entity) })))

const statusOf = (entity: Entity | undefined) => entity?.entity_payload.fields.status?.value

const until = (condition: () => boolean) =>
  Effect.sync(condition).pipe(
    Effect.repeat({ until: (done) => done, schedule: Schedule.spaced("20 millis") }),
    Effect.timeoutOrElse({ duration: "10 seconds", orElse: () => Effect.die(new Error("Slack did not get the call")) }),
  )

const calls = (method: string) => slack.posted.filter((each) => each.method === method)

const installed = Effect.fnUntraced(function* (o: Effect.Success<typeof TaskFixture.org>) {
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
    space_id: o.factory.id,
    created_by: o.ada.userId,
  })
  return { workspace, channel }
})

const threadIn = (channel: string) => {
  const seconds = String(Math.floor(Math.random() * 9e9) + 1e9)
  const key = `${channel}:${seconds}.000100`
  slack.threads.set(key, [])
  return { key, url: `https://acme.slack.com/archives/${channel}/p${seconds}000100` }
}

const threaded = Effect.fnUntraced(function* (
  o: Effect.Success<typeof TaskFixture.org>,
  workspace: string,
  key: string,
  sessionId?: Session.ID,
) {
  const database = yield* Database.Service
  yield* database.db.insert(Database.Schema.intake_thread).values({
    id: Channel.ThreadID.create(),
    organization_id: o.organizationId,
    origin: "slack",
    scope: workspace,
    thread: key,
    session_id:
      sessionId ??
      (yield* Seed.session({ organizationId: o.organizationId, spaceId: o.factory.id, createdBy: o.ada.userId })),
  })
})

const buttonsOf = (message: SlackServer.Posted | undefined) => {
  const actions = metadataOf(message)?.entities.at(0)?.entity_payload.actions
  return [actions?.primary_actions ?? [], actions?.overflow_actions ?? []].map((each) =>
    each.map((action) => action.text),
  )
}

const linksOf = (message: SlackServer.Posted | undefined) => {
  const actions = metadataOf(message)?.entities.at(0)?.entity_payload.actions
  return [...(actions?.primary_actions ?? []), ...(actions?.overflow_actions ?? [])].flatMap((action) =>
    action.url ? [[action.text, action.url]] : [],
  )
}

const actionsOf = Effect.gen(function* () {
  const context = yield* Layer.build(
    SlackTaskActions.layer.pipe(
      Layer.provide(ChannelRoute.layer),
      Layer.provide(ChannelIdentity.layer),
      Layer.provide(ChannelProvider.layer(Effect.all([Slack.provider]))),
      Layer.provide(slackCards),
      Layer.provide(ConfigProvider.layerAdd(ConfigProvider.fromUnknown({ APP_URL: app }))),
    ),
  )
  return Context.get(context, SlackTaskActions.Service)
})

const cardsOf = Effect.gen(function* () {
  const context = yield* Layer.build(slackCards)
  return Context.get(context, SlackTaskCard.Service)
})

describe("SlackTaskCard", () => {
  it.live(
    "a task posts one card in each linked thread and the next change edits it; only a mapped channel shows the title",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const o = yield* TaskFixture.org
        const found = yield* installed(o)
        const mapped = threadIn(found.channel)
        const other = threadIn("CSALES")
        const created = yield* tasks.create(o.ada, {
          spaceId: o.factory.id,
          title: "Fix the deploy",
          links: [mapped.url, other.url],
        })
        yield* until(() => slack.threads.get(mapped.key)?.length === 1 && slack.threads.get(other.key)?.length === 1)
        const card = slack.threads.get(mapped.key)?.at(0)
        expect(card?.text).toContain("Fix the deploy")
        expect(metadataOf(card)?.event_payload).toEqual({ task_id: created.id, kind: "card" })
        expect(metadataOf(card)?.entities.map((entity) => entity.entity_payload.attributes.title.text)).toEqual([
          "Fix the deploy",
        ])
        const hidden = slack.threads.get(other.key)?.at(0)
        expect(hidden?.text).not.toContain("Fix the deploy")
        expect(metadataOf(hidden)?.entities.at(0)?.entity_payload.attributes.title.text).toBe(created.identifier)
        const updates = calls("chat.update").length
        yield* tasks.update(o.ada, created.id, { status: "in_progress" })
        yield* until(() => calls("chat.update").length === updates + 2)
        expect(slack.threads.get(mapped.key)).toHaveLength(1)
        expect(statusOf(metadataOf(slack.threads.get(mapped.key)?.at(0))?.entities.at(0))).toBe("In progress")
      }),
  )

  it.live(
    "review and done notices tag the person with the card, except from the thread's own session; later changes edit their card and keep their text",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const database = yield* Database.Service
        const o = yield* TaskFixture.org
        const found = yield* installed(o)
        const thread = threadIn(found.channel)
        const build = yield* o.agentIn(o.ada, o.factory.id)
        yield* threaded(o, found.workspace, thread.key, build.agent.sessionId)
        yield* database.db.insert(Database.Schema.account).values({
          id: Auth.AccountID.create(),
          providerId: "slack",
          accountId: `${found.workspace}:UADA`,
          userId: o.ada.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Ship SSO", links: [thread.url] })
        yield* until(() => slack.threads.get(thread.key)?.length === 1)
        yield* tasks.review(build, created.id, { humanReview: true, reason: "From the thread" })
        yield* tasks.review(o.ada, created.id, { humanReview: true, reason: "Check the plan" })
        const messages = () => slack.threads.get(thread.key) ?? []
        yield* until(() => statusOf(metadataOf(messages().at(1))?.entities.at(0)) === "Needs review")
        expect(messages().at(1)?.text).toBe(
          `<@UADA> Needs a person: Check the plan <${app}/tasks/${created.id}|Open the task>`,
        )
        expect(metadataOf(messages().at(1))?.event_payload.kind).toBe("notice")
        yield* tasks.update(o.ada, created.id, { status: "done" })
        yield* until(() => messages().every((message) => statusOf(metadataOf(message)?.entities.at(0)) === "Done"))
        expect(messages().at(0)?.text).toContain("Ship SSO · Done")
        expect(
          messages()
            .slice(1)
            .map((message) => message.text.split(" <")[0]),
        ).toEqual(["<@UADA> Needs a person: Check the plan", "<@UADA> Done."])
      }),
  )

  it.live("a notice tags the person found by email, and goes without the card when Slack refuses its metadata", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const database = yield* Database.Service
      const o = yield* TaskFixture.org
      const found = yield* installed(o)
      const thread = threadIn(found.channel)
      yield* threaded(o, found.workspace, thread.key)
      const email = (yield* database.db
        .select({ email: Database.Schema.user.email })
        .from(Database.Schema.user)
        .where(eq(Database.Schema.user.id, o.ada.userId))).at(0)?.email
      slack.users.set("UMAIL", { name: "ada", real_name: "Ada", ...(email && { email }) })
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Ship SSO", links: [thread.url] })
      yield* until(() => slack.threads.get(thread.key)?.length === 1)
      slack.options.metadataError = "invalid_metadata_schema"
      yield* tasks.review(o.ada, created.id, { humanReview: true, reason: "Look" }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            slack.options.metadataError = undefined
          }),
        ),
      )
      const notice = slack.threads.get(thread.key)?.at(1)
      expect(notice?.text.startsWith("<@UMAIL> Needs a person: Look")).toBe(true)
      expect(notice?.metadata).toBeUndefined()
    }),
  )

  it.live(
    "a shared task URL of the organization unfurls as its card, titled only in a mapped channel; others do not unfurl",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const o = yield* TaskFixture.org
        const found = yield* installed(o)
        const cards = yield* cardsOf
        const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Fix the deploy" })
        const archived = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Old" })
        yield* tasks.archive(o.ada, archived.id)
        const shared = (place: string, urls: ReadonlyArray<string>) =>
          cards.unfurl(o.organizationId, {
            kind: "links_shared",
            install: found.workspace,
            place,
            message: "1712.000200",
            urls,
          })
        const before = calls("chat.unfurl").length
        yield* shared(found.channel, [
          `${app}/tasks/${created.identifier}?tab=activity`,
          `${app}/tasks/${created.id}`,
          `${app}/tasks/${archived.identifier}`,
          `${app}/tasks/OTHER-1`,
          `${app}/tasks/not-a-task`,
          `${app}/sessions/ses_01M6NZMF5TRCM677MMNXB5MHQN`,
        ])
        yield* until(() => calls("chat.unfurl").length === before + 1)
        const unfurled = calls("chat.unfurl").at(-1)?.params
        expect([unfurled?.channel, unfurled?.ts]).toEqual([found.channel, "1712.000200"])
        const entities = entitiesIn(unfurled?.metadata).entities
        expect(entities.map((entity) => [entity.external_ref.id, entity.entity_payload.attributes.title.text])).toEqual(
          [
            [created.id, "Fix the deploy"],
            [created.id, "Fix the deploy"],
          ],
        )
        yield* shared("CSALES", [`${app}/tasks/${created.identifier}`])
        yield* until(() => calls("chat.unfurl").length === before + 2)
        expect(calls("chat.unfurl").at(-1)?.params.metadata).toContain(`"title":{"text":"${created.identifier}"}`)
        yield* shared(found.channel, [`${app}/sessions/ses_01M6NZMF5TRCM677MMNXB5MHQN`])
        yield* cards.unfurl(o.organizationId, {
          kind: "links_shared",
          install: found.workspace,
          place: "COMPOSER",
          message: "U01-draft",
          unfurl: { id: "U01-draft", source: "composer" },
          urls: [`${app}/tasks/${created.identifier}`],
        })
        yield* until(() => calls("chat.unfurl").length === before + 3)
        expect(calls("chat.unfurl").at(-1)?.params).toMatchObject({ unfurl_id: "U01-draft", source: "composer" })
      }),
  )

  it.live(
    "the details show the description, links and sessions only in a mapped channel; an unknown task is not found",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const o = yield* TaskFixture.org
        const found = yield* installed(o)
        const cards = yield* cardsOf
        const build = yield* o.agentIn(o.ada, o.factory.id)
        const created = yield* tasks.create(build, {
          spaceId: o.factory.id,
          title: "Fix the deploy",
          description: "The deploy fails at 10:02.",
          links: ["https://github.com/acme/web/pull/41"],
        })
        const requested = (place: string, externalId: string) =>
          cards.present(o.organizationId, {
            kind: "details_requested",
            install: found.workspace,
            place,
            trigger: `trigger-${place}`,
            url: `${app}/tasks/${created.identifier}`,
            externalId,
          })
        const before = calls("entity.presentDetails").length
        yield* requested(found.channel, created.id)
        yield* until(() => calls("entity.presentDetails").length === before + 1)
        const full = entityIn(calls("entity.presentDetails").at(-1)?.params.metadata)
        expect(full.entity_payload.fields.description?.value).toBe("The deploy fails at 10:02.")
        expect(full.entity_payload.custom_fields.map((field) => field.key)).toEqual([
          "pull_request",
          "latest_session",
          "links",
          "sessions",
          "latest_activity",
        ])
        expect(full.entity_payload.custom_fields.at(-1)?.value).toBe("Links changed by build")
        yield* requested("CSALES", created.id)
        yield* until(() => calls("entity.presentDetails").length === before + 2)
        const limited = entityIn(calls("entity.presentDetails").at(-1)?.params.metadata)
        expect(limited.entity_payload.attributes.title.text).toBe(created.identifier)
        expect(limited.entity_payload.fields.description).toBeUndefined()
        expect(limited.entity_payload.custom_fields.map((field) => field.key)).toEqual([
          "pull_request",
          "latest_session",
          "latest_activity",
        ])
        yield* requested(found.channel, "tsk_01M6NZMF5TRCM677MMNXB5MHQN")
        yield* until(() => calls("entity.presentDetails").length === before + 3)
        expect(calls("entity.presentDetails").at(-1)?.params.error).toBe(JSON.stringify({ status: "not_found" }))
        yield* requested(found.channel, "not-a-task")
        yield* until(() => calls("entity.presentDetails").length === before + 4)
        expect(calls("entity.presentDetails").at(-1)?.params.error).toBe(JSON.stringify({ status: "not_found" }))
      }),
  )

  it.live(
    "a card button acts as the person who clicked and the card shows the next state's buttons; others get a private reply",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const database = yield* Database.Service
        const o = yield* TaskFixture.org
        const found = yield* installed(o)
        const actions = yield* actionsOf
        const thread = threadIn(found.channel)
        yield* database.db.insert(Database.Schema.account).values(
          [
            { user: "UADA", userId: o.ada.userId },
            { user: "UGRACE", userId: o.grace.userId },
          ].map((each) => ({
            id: Auth.AccountID.create(),
            providerId: "slack",
            accountId: `${found.workspace}:${each.user}`,
            userId: each.userId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        )
        const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Ship SSO", links: [thread.url] })
        const card = () => buttonsOf(slack.threads.get(thread.key)?.at(0))
        const shows = (primary: ReadonlyArray<string>) => until(() => card()[0]?.join() === primary.join())
        const click = (user: string, action: Channel.CardAction) =>
          actions.act(o.organizationId, {
            kind: "card_action",
            install: found.workspace,
            sender: { accountId: `${found.workspace}:${user}` },
            taskId: created.id,
            action,
            responseUrl: `${slack.url}/response/${user}`,
          })
        const replied = (count: number) => until(() => slack.responses.length === count)
        yield* shows(["Assign to me"])
        expect(card()[1]).toEqual(["Open in Ren", "Dismiss"])
        yield* click("UADA", "assign_to_me")
        yield* shows(["Open in Ren"])
        expect(card()[1]).toEqual(["Dismiss"])
        expect((yield* tasks.get(o.ada, created.id)).ownerId).toBe(o.ada.userId)
        const before = slack.responses.length
        yield* click("UNOBODY", "dismiss")
        yield* replied(before + 1)
        expect(JSON.stringify(slack.responses.at(-1))).toContain("Connect your Ren account")
        yield* click("UGRACE", "dismiss")
        yield* replied(before + 2)
        expect(slack.responses.at(-1)).toMatchObject({ response_type: "ephemeral" })
        expect((yield* tasks.get(o.ada, created.id)).status).toBe("todo")
        yield* tasks.review(o.ada, created.id, { humanReview: true, reason: "Check the plan" })
        yield* shows(["Start build"])
        expect(card()[1]).toEqual(["Open in Ren"])
        yield* tasks.update(o.ada, created.id, { addLinks: ["https://github.com/acme/web/issues/7"] })
        yield* until(() => card()[1]?.join() === "Open plan")
        expect(linksOf(slack.threads.get(thread.key)?.at(0)).at(-1)).toEqual([
          "Open plan",
          "https://github.com/acme/web/issues/7",
        ])
        yield* click("UADA", "approve")
        yield* shows(["Open in Ren"])
        const events = yield* database.db
          .select({ data: Database.Schema.task_event.data, userId: Database.Schema.task_event.actor_user_id })
          .from(Database.Schema.task_event)
          .where(eq(Database.Schema.task_event.task_id, created.id))
        expect(events.find((each) => each.data._tag === "reviewed")?.userId).toBe(o.ada.userId)
        expect((yield* tasks.get(o.ada, created.id)).humanReview).toBe(false)
      }),
  )
  it.live(
    "two Start clicks at once start one session; the card then shows the running, review, done and archived buttons",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const database = yield* Database.Service
        const o = yield* TaskFixture.org
        const found = yield* installed(o)
        const actions = yield* actionsOf
        const thread = threadIn(found.channel)
        yield* database.db.insert(Database.Schema.account).values({
          id: Auth.AccountID.create(),
          providerId: "slack",
          accountId: `${found.workspace}:UADA`,
          userId: o.ada.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        const plan = yield* o.agent("plan")
        const created = yield* tasks.create(o.ada, {
          spaceId: o.factory.id,
          title: "Ship SSO",
          agentId: plan,
          links: [thread.url],
        })
        const message = () => slack.threads.get(thread.key)?.at(0)
        const card = () => buttonsOf(message())
        const shows = (primary: ReadonlyArray<string>) => until(() => card()[0]?.join() === primary.join())
        yield* shows(["Start"])
        expect(card()[1]).toEqual(["Open in Ren", "Dismiss"])
        const before = slack.responses.length
        const click = actions.act(o.organizationId, {
          kind: "card_action",
          install: found.workspace,
          sender: { accountId: `${found.workspace}:UADA` },
          taskId: created.id,
          action: "start",
          responseUrl: `${slack.url}/response/UADA`,
        })
        yield* Effect.all([click, click], { concurrency: "unbounded" })
        yield* until(() => slack.responses.length === before + 1)
        expect(JSON.stringify(slack.responses.at(-1))).toContain("This task already started.")
        yield* shows(["Open session"])
        const sessions = yield* TaskFixture.sessions(created.id)
        expect(sessions).toHaveLength(1)
        expect(card()[1]).toEqual(["Request review", "Mark done"])
        expect(linksOf(message())).toEqual([["Open session", `${app}/sessions/${sessions.at(0)?.sessionId}`]])
        const pull = "https://github.com/acme/web/pull/41"
        yield* tasks.update(o.ada, created.id, { addLinks: [pull] })
        yield* tasks.review(o.ada, created.id, { humanReview: true, reason: "Check the PR" })
        yield* shows(["Approve"])
        expect(card()[1]).toEqual(["Open session", "Open PR"])
        expect(linksOf(message()).at(-1)).toEqual(["Open PR", pull])
        yield* tasks.update(o.ada, created.id, { status: "done" })
        yield* shows(["Open in Ren"])
        expect(card()[1]).toEqual(["Open PR"])
        expect(linksOf(message()).at(0)).toEqual(["Open in Ren", `${app}/tasks/${created.identifier}`])
        yield* tasks.archive(o.ada, created.id)
        yield* until(() => card().flat().length === 0)
      }),
  )
})
