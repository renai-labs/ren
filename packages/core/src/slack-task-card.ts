export * as SlackTaskCard from "./slack-task-card.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { Space } from "@ren/schema/space"
import { Task } from "@ren/schema/task"
import type { TaskEvent } from "@ren/schema/task-event"
import { and, asc, desc, eq, isNull, like, or } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option, Redacted, Schema, Stream } from "effect"
import { Slack } from "./channel-provider/slack.js"
import type { ChannelSecrets } from "./channel-secrets.js"
import { SlackApp } from "./slack-app.js"

type LinksShared = Extract<Channel.Signal, { readonly kind: "links_shared" }>

type DetailsRequested = Extract<Channel.Signal, { readonly kind: "details_requested" }>

export interface Notice {
  readonly organizationId: Auth.OrganizationID
  readonly taskId: Task.ID
  readonly thread: string
  readonly text: string
}

export interface Interface {
  readonly refresh: (taskId: Task.ID) => Effect.Effect<void>
  readonly post: (notice: Notice) => Effect.Effect<void>
  readonly unfurl: (organizationId: Auth.OrganizationID, shared: LinksShared) => Effect.Effect<void>
  readonly present: (organizationId: Auth.OrganizationID, requested: DetailsRequested) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SlackTaskCard") {}

const none: Interface = {
  refresh: () => Effect.void,
  post: () => Effect.void,
  unfurl: () => Effect.void,
  present: () => Effect.void,
}

export const layerNone = Layer.succeed(Service, Service.of(none))

export const eventType = "ren_task_card"

const statusText: Readonly<Record<Task.Status, string>> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
}

const statusColor: Readonly<Record<Task.Status, string>> = {
  todo: "gray",
  in_progress: "blue",
  done: "green",
  dismissed: "gray",
}

const priorityText: Readonly<Record<Task.Priority, string>> = { low: "Low", medium: "Medium", high: "High" }

const eventLabels: Readonly<Record<TaskEvent.Kind, string>> = {
  created: "Created",
  assigned: "Assigned",
  started: "Started",
  status: "Status changed",
  review_requested: "Review requested",
  reviewed: "Reviewed",
  field: "Edited",
  label: "Labels changed",
  link: "Links changed",
  parent: "Parent changed",
  archived: "Archived",
}

const repliesPerPage = 200

const replyPages = 10

const Message = Schema.Struct({
  ts: Schema.String,
  user: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  blocks: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  metadata: Schema.optionalKey(
    Schema.Struct({
      event_type: Schema.optionalKey(Schema.String),
      event_payload: Schema.optionalKey(
        Schema.Struct({ task_id: Schema.optionalKey(Schema.String), kind: Schema.optionalKey(Schema.String) }),
      ),
      entities: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({ external_ref: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.String) })) }),
        ),
      ),
    }),
  ),
})

const Replies = Schema.Struct({
  messages: Schema.Array(Message),
  response_metadata: Schema.optionalKey(Schema.Struct({ next_cursor: Schema.optionalKey(Schema.String) })),
})

const Posted = Schema.Struct({ ts: Schema.String })

const Answered = Schema.Struct({})

const LookedUp = Schema.Struct({ user: Schema.Struct({ id: Schema.String }) })

interface Card {
  readonly id: Task.ID
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
  readonly identifier: string
  readonly title: string
  readonly description: string | null
  readonly status: Task.Status
  readonly priority: Task.Priority | null
  readonly humanReview: boolean
  readonly archived: boolean
  readonly agent: string | null
  readonly ownerId: Auth.UserID | null
  readonly person: Auth.UserID | null
  readonly links: ReadonlyArray<{ readonly kind: string; readonly key: string; readonly url: string }>
  readonly sessions: ReadonlyArray<{ readonly sessionId: string; readonly agent: string | null }>
  readonly activity: Option.Option<{ readonly label: string; readonly by: string | null; readonly at: Date }>
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000)

const threadOf = (key: string) => ({ channel: key.slice(0, key.indexOf(":")), ts: key.slice(key.indexOf(":") + 1) })

const statusField = (card: Card) => {
  if (card.archived) return { value: "Archived", tag_color: "gray" }
  if (card.humanReview && Task.actionable.includes(card.status)) return { value: "Needs review", tag_color: "yellow" }
  return { value: statusText[card.status], tag_color: statusColor[card.status] }
}

const summaryFields = (app: string, card: Card) => {
  const pull = card.links.findLast((link) => link.kind === "github_pr")
  const session = card.sessions.at(-1)
  return [
    ...(card.agent ? [{ key: "agent", label: "Agent", type: "string", value: card.agent }] : []),
    ...(pull ? [{ key: "pull_request", label: "PR", type: "string", value: pull.key, link: pull.url }] : []),
    ...(session
      ? [
          {
            key: "latest_session",
            label: "Latest session",
            type: "string",
            value: session.agent ?? session.sessionId,
            link: `${app}/sessions/${session.sessionId}`,
          },
        ]
      : []),
  ]
}

const actionsOf = (app: string, card: Card) => {
  const button = (action: Channel.CardAction, text: string) => [
    { text, action_id: `${Slack.taskActionPrefix}${action}`, value: card.id },
  ]
  const link = (name: string, text: string, url: string | undefined) =>
    url ? [{ text, action_id: `${Slack.taskActionPrefix}open_${name}`, url }] : []
  const pull = card.links.findLast((each) => each.kind === "github_pr")?.url
  const issue = card.links.findLast((each) => each.kind === "github_issue")?.url
  const session = card.sessions.at(-1)
  const openSession = link("session", "Open session", session && `${app}/sessions/${session.sessionId}`)
  const openInRen = link("ren", "Open in Ren", `${app}/tasks/${card.identifier}`)
  const shown = (primary: ReadonlyArray<object>, overflow: ReadonlyArray<object>) => ({
    ...(primary.length > 0 && { primary_actions: primary }),
    ...(overflow.length > 0 && { overflow_actions: overflow }),
  })
  if (card.archived) return undefined
  if (!Task.actionable.includes(card.status)) return shown(openInRen, link("pr", "Open PR", pull))
  if (card.humanReview && pull)
    return shown(button("approve", "Approve"), [...openSession, ...link("pr", "Open PR", pull)])
  if (card.humanReview)
    return shown(button("approve", "Start build"), issue ? link("plan", "Open plan", issue) : openInRen)
  if (card.status === "in_progress")
    return shown(openSession, [...button("request_review", "Request review"), ...button("done", "Mark done")])
  if (card.agent) return shown(button("start", "Start"), [...openInRen, ...button("dismiss", "Dismiss")])
  if (!card.ownerId)
    return shown(button("assign_to_me", "Assign to me"), [...openInRen, ...button("dismiss", "Dismiss")])
  return shown(openInRen, button("dismiss", "Dismiss"))
}

const listField = (key: string, label: string, lines: ReadonlyArray<string>) =>
  lines.length > 0 ? [{ key, label, type: "string", format: "markdown", long: true, value: lines.join("\n") }] : []

const detailFields = (app: string, card: Card, options: { readonly titled: boolean }) => {
  const activity = Option.getOrUndefined(card.activity)
  return [
    ...(options.titled
      ? [
          ...listField(
            "links",
            "Links",
            card.links.map((link) => `- [${link.kind === "url" ? link.url : link.key}](${link.url})`),
          ),
          ...listField(
            "sessions",
            "Sessions",
            card.sessions.map(
              (each) => `- ${each.agent ?? "—"}: [${each.sessionId}](${app}/sessions/${each.sessionId})`,
            ),
          ),
        ]
      : []),
    ...(activity
      ? [
          {
            key: "latest_activity",
            label: "Latest activity",
            type: "string",
            value: activity.by ? `${activity.label} by ${activity.by}` : activity.label,
          },
        ]
      : []),
  ]
}

// oxlint-disable-next-line ren/no-comments -- Slack shows a card to everyone in the channel, so the title and the details show only in a channel that maps to the task's space. The caller does not wait for Slack; a failure leaves a card stale until the next change, and two changes at one moment can post two cards.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const slack = yield* SlackApp.Service
    if (Option.isNone(slack.client)) return Service.of(none)
    const client = slack.client.value
    const app = (yield* Config.String("APP_URL").pipe(Effect.orDie)).replace(/\/$/u, "")
    const scope = yield* Effect.scope
    const task = Database.Schema.task
    const agent = Database.Schema.agent
    const user = Database.Schema.user
    const urlOf = (card: Pick<Card, "identifier">) => `${app}/tasks/${card.identifier}`

    const cardOf = Effect.fnUntraced(function* (taskId: Task.ID) {
      const row = (yield* database.db
        .select({
          organizationId: task.organization_id,
          spaceId: task.space_id,
          number: task.number,
          prefix: Database.Schema.task_sequence.prefix,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          humanReview: task.human_review,
          archivedAt: task.archived_at,
          agent: agent.name,
          ownerId: task.owner_id,
          createdBy: task.created_by_user_id,
        })
        .from(task)
        .innerJoin(
          Database.Schema.task_sequence,
          eq(Database.Schema.task_sequence.organization_id, task.organization_id),
        )
        .leftJoin(agent, eq(agent.id, task.agent_id))
        .where(eq(task.id, taskId))).at(0)
      if (!row) return Option.none<Card>()
      const links = yield* database.db
        .select({
          kind: Database.Schema.task_link.kind,
          key: Database.Schema.task_link.key,
          url: Database.Schema.task_link.url,
        })
        .from(Database.Schema.task_link)
        .where(eq(Database.Schema.task_link.task_id, taskId))
        .orderBy(asc(Database.Schema.task_link.created_at), asc(Database.Schema.task_link.id))
      const sessions = yield* database.db
        .select({ sessionId: Database.Schema.task_session.session_id, agent: agent.name })
        .from(Database.Schema.task_session)
        .leftJoin(agent, eq(agent.id, Database.Schema.task_session.agent_id))
        .where(eq(Database.Schema.task_session.task_id, taskId))
        .orderBy(asc(Database.Schema.task_session.created_at), asc(Database.Schema.task_session.session_id))
      const event = (yield* database.db
        .select({
          data: Database.Schema.task_event.data,
          at: Database.Schema.task_event.created_at,
          user: user.name,
          agent: agent.name,
        })
        .from(Database.Schema.task_event)
        .leftJoin(user, eq(user.id, Database.Schema.task_event.actor_user_id))
        .leftJoin(agent, eq(agent.id, Database.Schema.task_event.actor_agent_id))
        .where(eq(Database.Schema.task_event.task_id, taskId))
        .orderBy(desc(Database.Schema.task_event.created_at), desc(Database.Schema.task_event.id))
        .limit(1)).at(0)
      const comment = (yield* database.db
        .select({ at: Database.Schema.task_comment.created_at, user: user.name, agent: agent.name })
        .from(Database.Schema.task_comment)
        .leftJoin(user, eq(user.id, Database.Schema.task_comment.author_user_id))
        .leftJoin(agent, eq(agent.id, Database.Schema.task_comment.author_agent_id))
        .where(and(eq(Database.Schema.task_comment.task_id, taskId), isNull(Database.Schema.task_comment.archived_at)))
        .orderBy(desc(Database.Schema.task_comment.created_at))
        .limit(1)).at(0)
      const activity =
        comment && (!event || comment.at > event.at)
          ? Option.some({ label: "Comment", by: comment.agent ?? comment.user, at: comment.at })
          : Option.map(Option.fromNullishOr(event), (found) => ({
              label:
                found.data._tag === "status" ? `Status: ${statusText[found.data.to]}` : eventLabels[found.data._tag],
              by: found.agent ?? found.user,
              at: found.at,
            }))
      return Option.some<Card>({
        id: taskId,
        organizationId: row.organizationId,
        spaceId: row.spaceId,
        identifier: `${row.prefix}-${row.number}`,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        humanReview: row.humanReview,
        archived: Boolean(row.archivedAt),
        agent: row.agent,
        ownerId: row.ownerId,
        person: row.ownerId ?? row.createdBy,
        links,
        sessions,
        activity,
      })
    })

    const taskIn = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, ref: string) {
      const named = /^(?<prefix>.+)-(?<number>\d{1,9})$/u.exec(ref)?.groups
      const byId = Schema.is(Task.ID)(ref) ? eq(task.id, ref) : undefined
      const byIdentifier =
        named?.prefix && named.number
          ? and(
              eq(Database.Schema.task_sequence.prefix, named.prefix.toUpperCase()),
              eq(task.number, Number(named.number)),
            )
          : undefined
      if (!byId && !byIdentifier) return Option.none<Card>()
      const found = (yield* database.db
        .select({ id: task.id })
        .from(task)
        .innerJoin(
          Database.Schema.task_sequence,
          eq(Database.Schema.task_sequence.organization_id, task.organization_id),
        )
        .where(and(eq(task.organization_id, organizationId), isNull(task.archived_at), or(byId, byIdentifier)))).at(0)
      return found ? yield* cardOf(found.id) : Option.none<Card>()
    })

    const refOf = (url: string) => {
      const prefix = `${app}/tasks/`
      return url.startsWith(prefix) ? /^[^/?#]+/u.exec(url.slice(prefix.length))?.at(0) : undefined
    }

    const titledIn = (card: Card, place: string | undefined) =>
      place
        ? database.db
            .select({ id: Database.Schema.channel_mapping.id })
            .from(Database.Schema.channel_mapping)
            .innerJoin(
              Database.Schema.channel_install,
              eq(Database.Schema.channel_install.id, Database.Schema.channel_mapping.install_id),
            )
            .where(
              and(
                eq(Database.Schema.channel_install.organization_id, card.organizationId),
                eq(Database.Schema.channel_install.provider, "slack"),
                eq(Database.Schema.channel_mapping.place, place),
                eq(Database.Schema.channel_mapping.space_id, card.spaceId),
              ),
            )
            .limit(1)
            .pipe(Effect.map((rows) => rows.length > 0))
        : Effect.succeed(false)

    const entityOf = (card: Card, options: { readonly titled: boolean; readonly detailed: boolean }) => {
      const activity = Option.getOrUndefined(card.activity)
      const actions = actionsOf(app, card)
      return {
        entity_type: "slack#/entities/task",
        url: urlOf(card),
        external_ref: { id: card.id },
        entity_payload: {
          attributes: {
            title: { text: options.titled ? card.title : card.identifier },
            display_id: card.identifier,
            ...(activity && { metadata_last_modified: seconds(activity.at) }),
          },
          fields: {
            status: statusField(card),
            ...(card.priority && { priority: { value: priorityText[card.priority] } }),
            ...(options.titled &&
              options.detailed &&
              card.description && { description: { value: card.description, format: "markdown" } }),
            ...(activity && { date_updated: { value: seconds(activity.at) } }),
          },
          custom_fields: [...summaryFields(app, card), ...(options.detailed ? detailFields(app, card, options) : [])],
          ...(actions && { actions }),
        },
      }
    }

    const metadataOf = (card: Card, options: { readonly kind: "card" | "notice"; readonly titled: boolean }) => ({
      event_type: eventType,
      event_payload: { task_id: card.id, kind: options.kind },
      entities: [entityOf(card, { titled: options.titled, detailed: false })],
    })

    const cardText = (card: Card, options: { readonly titled: boolean }) =>
      [
        `**[${card.identifier}](${urlOf(card)})**`,
        ...(options.titled ? [card.title] : []),
        `· ${card.archived ? "Archived" : statusText[card.status]}`,
      ].join(" ")

    const installOf = (organizationId: Auth.OrganizationID) =>
      slack.installOf(organizationId).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(new SlackApp.Failed({ message: `No Slack install of ${organizationId}` })),
            onSome: Effect.succeed<ChannelSecrets.Found>,
          }),
        ),
      )

    const ownOf = (install: ChannelSecrets.Found, card: Card) => (message: typeof Message.Type) =>
      (!install.botUser || message.user === install.botUser) &&
      message.metadata?.event_type === eventType &&
      (message.metadata.event_payload?.task_id === card.id ||
        (message.metadata.entities ?? []).some((entity) => entity.external_ref?.id === card.id))

    const messagesOf = (token: Redacted.Redacted, thread: { readonly channel: string; readonly ts: string }) =>
      Stream.paginate({ cursor: "", page: 1 }, (state) =>
        client
          .post(
            "conversations.replies",
            {
              channel: thread.channel,
              ts: thread.ts,
              include_all_metadata: true,
              limit: repliesPerPage,
              ...(state.cursor && { cursor: state.cursor }),
            },
            Replies,
            token,
          )
          .pipe(
            Effect.map((answer) => {
              const cursor = answer.response_metadata?.next_cursor
              return [
                answer.messages,
                cursor && state.page < replyPages ? Option.some({ cursor, page: state.page + 1 }) : Option.none(),
              ] as const
            }),
          ),
      ).pipe(
        Stream.runCollect,
        Effect.map((pages) => pages.flat()),
      )

    const sync = Effect.fnUntraced(function* (taskId: Task.ID) {
      const threads = yield* database.db
        .select({ key: Database.Schema.task_link.key })
        .from(Database.Schema.task_link)
        .where(and(eq(Database.Schema.task_link.task_id, taskId), eq(Database.Schema.task_link.kind, "slack_thread")))
        .orderBy(asc(Database.Schema.task_link.created_at))
      if (threads.length === 0) return
      const found = yield* cardOf(taskId)
      if (Option.isNone(found)) return
      const card = found.value
      const install = yield* installOf(card.organizationId)
      yield* Effect.forEach(
        threads,
        (linked) =>
          Effect.gen(function* () {
            const thread = threadOf(linked.key)
            const titled = yield* titledIn(card, thread.channel)
            const own = (yield* messagesOf(install.secret, thread)).filter(ownOf(install, card))
            if (own.length === 0 && !card.archived)
              yield* client.post(
                "chat.postMessage",
                {
                  channel: thread.channel,
                  thread_ts: thread.ts,
                  unfurl_links: false,
                  ...Slack.message(cardText(card, { titled })),
                  metadata: metadataOf(card, { kind: "card", titled }),
                },
                Posted,
                install.secret,
              )
            yield* Effect.forEach(
              own,
              (message) =>
                client.post(
                  "chat.update",
                  {
                    channel: thread.channel,
                    ts: message.ts,
                    ...(message.metadata?.event_payload?.kind === "notice"
                      ? { text: message.text ?? "", ...(message.blocks && { blocks: message.blocks }) }
                      : Slack.message(cardText(card, { titled }))),
                    metadata: metadataOf(card, {
                      kind: message.metadata?.event_payload?.kind === "notice" ? "notice" : "card",
                      titled,
                    }),
                  },
                  Answered,
                  install.secret,
                ),
              { discard: true },
            )
          }).pipe(
            Effect.catchTag("SlackApp.Failed", (error) =>
              Effect.logWarning(`The Slack card of ${taskId} in ${linked.key} was not written`, error),
            ),
          ),
        { discard: true },
      )
    })

    const mentionOf = Effect.fnUntraced(function* (install: ChannelSecrets.Found, card: Card) {
      const person = card.person
      if (!person) return Option.none<string>()
      const account = (yield* database.db
        .select({ accountId: Database.Schema.account.accountId })
        .from(Database.Schema.account)
        .where(
          and(
            eq(Database.Schema.account.userId, person),
            eq(Database.Schema.account.providerId, "slack"),
            like(Database.Schema.account.accountId, `${install.workspace}:%`),
          ),
        )
        .limit(1)).at(0)
      if (account) return Option.some(account.accountId.slice(install.workspace.length + 1))
      const email = (yield* database.db.select({ email: user.email }).from(user).where(eq(user.id, person))).at(
        0,
      )?.email
      if (!email) return Option.none<string>()
      return yield* client.post("users.lookupByEmail", { email }, LookedUp, install.secret).pipe(
        Effect.map((answer) => Option.some(answer.user.id)),
        Effect.catchTag("SlackApp.Failed", (error) =>
          error.error === "users_not_found"
            ? Effect.succeedNone
            : Effect.logWarning(`The Slack user of ${person} could not be found`, error).pipe(
                Effect.as(Option.none<string>()),
              ),
        ),
      )
    })

    const post = Effect.fnUntraced(function* (notice: Notice) {
      const found = yield* cardOf(notice.taskId)
      if (Option.isNone(found)) return
      const card = found.value
      const install = yield* installOf(notice.organizationId)
      const thread = threadOf(notice.thread)
      const titled = yield* titledIn(card, thread.channel)
      const mention = yield* mentionOf(install, card)
      const text = Option.match(mention, { onNone: () => notice.text, onSome: (id) => `<@${id}> ${notice.text}` })
      const send = (metadata: object) =>
        client.post(
          "chat.postMessage",
          {
            channel: thread.channel,
            thread_ts: thread.ts,
            unfurl_links: false,
            ...Slack.message(text),
            ...metadata,
          },
          Posted,
          install.secret,
        )
      yield* send({ metadata: metadataOf(card, { kind: "notice", titled }) }).pipe(
        Effect.catchTag("SlackApp.Failed", (error) =>
          error.error?.includes("metadata")
            ? Effect.logWarning(`Slack refused the card of ${card.id}; the notice goes without it`, error).pipe(
                Effect.andThen(send({})),
              )
            : Effect.fail(error),
        ),
      )
    })

    const unfurl = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, shared: LinksShared) {
      const install = yield* installOf(organizationId)
      const entities = yield* Effect.forEach(shared.urls, (url) =>
        Effect.gen(function* () {
          const ref = refOf(url)
          if (!ref) return []
          const found = yield* taskIn(organizationId, ref)
          if (Option.isNone(found)) return []
          const titled = yield* titledIn(found.value, shared.place)
          return [{ app_unfurl_url: url, ...entityOf(found.value, { titled, detailed: false }) }]
        }),
      ).pipe(Effect.map((each) => each.flat()))
      if (entities.length === 0) return
      yield* client.post(
        "chat.unfurl",
        {
          ...(shared.unfurl?.source === "composer"
            ? { unfurl_id: shared.unfurl.id, source: shared.unfurl.source }
            : { channel: shared.place, ts: shared.message }),
          metadata: { entities },
        },
        Answered,
        install.secret,
      )
    })

    const present = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, requested: DetailsRequested) {
      const install = yield* installOf(organizationId)
      const ref = requested.externalId ?? refOf(requested.url)
      const found = ref ? yield* taskIn(organizationId, ref) : Option.none<Card>()
      const details = Option.isSome(found)
        ? {
            metadata: entityOf(found.value, {
              titled: yield* titledIn(found.value, requested.place),
              detailed: true,
            }),
          }
        : { error: { status: "not_found" } }
      yield* client.post(
        "entity.presentDetails",
        { trigger_id: requested.trigger, ...details },
        Answered,
        install.secret,
      )
    })

    const background = (name: string, about: string, effect: Effect.Effect<void, unknown>) =>
      effect.pipe(
        Effect.catchCause((cause) => Effect.logWarning(`The Slack card of ${about} was not written`, cause)),
        Effect.withSpan(`SlackTaskCard.${name}`),
        Effect.forkIn(scope),
        Effect.asVoid,
      )

    return Service.of({
      refresh: (taskId) => background("refresh", taskId, sync(taskId)),
      post: (notice) =>
        post(notice).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`A Slack notice of ${notice.taskId} could not be sent`, cause),
          ),
          Effect.withSpan("SlackTaskCard.post"),
        ),
      unfurl: (organizationId, shared) => background("unfurl", shared.urls.join(" "), unfurl(organizationId, shared)),
      present: (organizationId, requested) => background("present", requested.url, present(organizationId, requested)),
    })
  }),
)
