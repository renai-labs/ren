export * as Slack from "./slack.js"

import { Channel } from "@ren/schema/channel"
import type { TaskLink } from "@ren/schema/task-link"
import { Clock, Effect, Option, Redacted, Result, Schema, Stream, Struct } from "effect"
import { createHmac, timingSafeEqual } from "node:crypto"
import { slackifyMarkdown } from "slackify-markdown"
import { ChannelProvider } from "../channel-provider.js"
import { ChannelSecrets } from "../channel-secrets.js"
import { SlackMessage } from "./slack-message.js"
import { SlackApp } from "../slack-app.js"

const SlackEvent = Schema.Struct({
  type: Schema.String,
  subtype: Schema.optionalKey(Schema.String),
  user: Schema.optionalKey(Schema.String),
  user_team: Schema.optionalKey(Schema.String),
  team: Schema.optionalKey(Schema.String),
  bot_id: Schema.optionalKey(Schema.String),
  channel: Schema.optionalKey(Schema.String),
  channel_type: Schema.optionalKey(Schema.String),
  ts: Schema.optionalKey(Schema.String),
  thread_ts: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  blocks: Schema.optionalKey(Schema.Unknown),
  attachments: Schema.optionalKey(Schema.Unknown),
  files: Schema.optionalKey(Schema.Unknown),
  tokens: Schema.optionalKey(Schema.Struct({ bot: Schema.optionalKey(Schema.Array(Schema.String)) })),
})

const Envelope = Schema.Struct({
  type: Schema.String,
  challenge: Schema.optionalKey(Schema.String),
  event_id: Schema.optionalKey(Schema.String),
  team_id: Schema.optionalKey(Schema.String),
  authorizations: Schema.optionalKey(
    Schema.Array(Schema.Struct({ team_id: Schema.NullOr(Schema.String), user_id: Schema.optionalKey(Schema.String) })),
  ),
  event: Schema.optionalKey(SlackEvent),
})

const Profile = Schema.Struct({
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.optionalKey(Schema.String),
    real_name: Schema.optionalKey(Schema.String),
    profile: Schema.optionalKey(
      Schema.Struct({ email: Schema.optionalKey(Schema.String), real_name: Schema.optionalKey(Schema.String) }),
    ),
  }),
})

const Permalink = Schema.Struct({ permalink: Schema.String })

const Reply = Schema.Struct({
  ts: Schema.String,
  user: Schema.optionalKey(Schema.String),
  bot_id: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  blocks: Schema.optionalKey(Schema.Unknown),
  attachments: Schema.optionalKey(Schema.Unknown),
  files: Schema.optionalKey(Schema.Unknown),
})

const Replies = Schema.Struct({
  messages: Schema.Array(Reply),
  response_metadata: Schema.optionalKey(Schema.Struct({ next_cursor: Schema.optionalKey(Schema.String) })),
})

const Access = Schema.Struct({
  access_token: Schema.String,
  bot_user_id: Schema.String,
  team: Schema.Struct({ id: Schema.String, name: Schema.optionalKey(Schema.String) }),
  authed_user: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.String) })),
})

const Conversation = Schema.Struct({ id: Schema.String, name: Schema.String, is_private: Schema.Boolean })

const Conversations = Schema.Struct({
  channels: Schema.Array(Conversation),
  response_metadata: Schema.optionalKey(Schema.Struct({ next_cursor: Schema.optionalKey(Schema.String) })),
})

const Info = Schema.Struct({ channel: Conversation })

const Posted = Schema.Struct({ ts: Schema.String })

const Revoked = Schema.Struct({ revoked: Schema.optionalKey(Schema.Boolean) })

const Answered = Schema.Struct({})

const settledReactions: ReadonlySet<string> = new Set(["already_reacted", "no_reaction"])

const decodeEnvelope = Schema.decodeUnknownEffect(Schema.fromJsonString(Envelope))

const signatureAge = 5 * 60

const maxPages = 25

const goneErrors = new Set(["channel_not_found", "not_in_channel", "is_archived"])

const revokedErrors = new Set(["invalid_auth", "token_revoked", "account_inactive", "not_authed"])

const markdownBudget = 11_000

const sectionLimit = 2_900

export const fallback = (text: string) => slackifyMarkdown(text).trimEnd()

const sections = (text: string): ReadonlyArray<string> => {
  if (text.length <= sectionLimit) return text ? [text] : []
  const candidate = text.slice(0, sectionLimit + 1)
  const at =
    [candidate.lastIndexOf("\n\n"), candidate.lastIndexOf("\n"), candidate.lastIndexOf(" ")].find(
      (index) => index > 0,
    ) ?? sectionLimit
  return [text.slice(0, at).trimEnd(), ...sections(text.slice(at).trimStart())]
}

export const blocks = (text: string) => {
  const trimmed = text.trimEnd()
  if (!trimmed) return []
  if (trimmed.length <= markdownBudget) return [{ type: "markdown", text: trimmed }]
  return sections(fallback(trimmed)).map((part) => ({ type: "section", text: { type: "mrkdwn", text: part } }))
}

const titleLimit = 50

const labelLimit = 20

const chartsPerMessage = 2

const pieSlices = 12

const seriesLimit = 12

const categoryLimit = 20

const chartErrors = new Set(["invalid_blocks", "invalid_blocks_format", "msg_blocks_too_long"])

const decodeChart = Schema.decodeUnknownResult(Channel.Chart)

const decodeTitle = Schema.decodeUnknownOption(Schema.Struct({ title: Schema.String }))

const cut = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`)

const count = (amount: number, one: string, many = `${one}s`) => `${amount} ${amount === 1 ? one : many}`

const distinct = (names: ReadonlyArray<string>) => {
  const taken = new Set<string>()
  return names.map((name) => {
    const unique = (count: number): string => {
      const suffix = count === 1 ? "" : ` ${count}`
      const candidate = `${cut(name, labelLimit - suffix.length)}${suffix}`
      return taken.has(candidate) ? unique(count + 1) : candidate
    }
    const found = unique(1)
    taken.add(found)
    return found
  })
}

const changesOf = (title: string, labels: ReadonlyArray<string>, fitted: ReadonlyArray<string>) => {
  const cuts = labels.filter((label) => label.length > labelLimit).length
  const renamed = labels.filter((label, index) => fitted[index] !== cut(label, labelLimit)).length
  return [
    ...(title.length > titleLimit ? [`Cut the title to ${titleLimit} characters.`] : []),
    ...(cuts > 0 ? [`Cut ${count(cuts, "label")} to ${labelLimit} characters.`] : []),
    ...(renamed > 0 ? [`Numbered ${count(renamed, "label")} that had the same name.`] : []),
  ]
}

type Checked =
  | { readonly title: string; readonly chart: Channel.Chart; readonly changes: ReadonlyArray<string> }
  | { readonly title: string; readonly reason: string }

const checkPie = (title: string, chart: Extract<Channel.Chart, { readonly type: "pie" }>): Checked => {
  const positive = chart.segments.filter((segment) => segment.value > 0)
  if (positive.length === 0) return { title, reason: "It has no slice with a value above 0." }
  const largest = positive.toSorted((left, right) => right.value - left.value)
  const shown = new Set(largest.slice(0, pieSlices - 1))
  const rest = largest.slice(pieSlices - 1)
  const segments =
    positive.length <= pieSlices
      ? positive
      : [
          ...positive.filter((segment) => shown.has(segment)),
          { label: "Other", value: rest.reduce((sum, segment) => sum + segment.value, 0) },
        ]
  const labels = segments.map((segment) => segment.label)
  const fitted = distinct(labels)
  return {
    title,
    chart: {
      type: "pie",
      title: cut(chart.title, titleLimit),
      segments: segments.map((segment, index) => ({ label: fitted[index] ?? segment.label, value: segment.value })),
    },
    changes: [
      ...changesOf(chart.title, labels, fitted),
      ...(positive.length < chart.segments.length
        ? [`Left out ${count(chart.segments.length - positive.length, "slice")} with a value of 0 or less.`]
        : []),
      ...(positive.length > pieSlices ? [`Merged the ${rest.length} smallest slices into Other.`] : []),
    ],
  }
}

const checkSeries = (title: string, chart: Exclude<Channel.Chart, { readonly type: "pie" }>): Checked => {
  if (chart.categories.length === 0 || chart.series.length === 0) return { title, reason: "It has no data." }
  if (chart.categories.length > categoryLimit) return { title, reason: `It has more than ${categoryLimit} categories.` }
  if (chart.series.length > seriesLimit) return { title, reason: `It has more than ${seriesLimit} series.` }
  const uneven = chart.series.find((series) => series.values.length !== chart.categories.length)
  if (uneven)
    return {
      title,
      reason: `Series ${uneven.name} has ${count(uneven.values.length, "value")} for ${count(chart.categories.length, "category", "categories")}.`,
    }
  const categories = distinct(chart.categories)
  const names = distinct(chart.series.map((series) => series.name))
  const axisCuts = [chart.xLabel, chart.yLabel].filter((label) => label && label.length > titleLimit).length
  return {
    title,
    chart: {
      ...chart,
      title: cut(chart.title, titleLimit),
      categories,
      series: chart.series.map((series, index) => ({ name: names[index] ?? series.name, values: series.values })),
      ...(chart.xLabel && { xLabel: cut(chart.xLabel, titleLimit) }),
      ...(chart.yLabel && { yLabel: cut(chart.yLabel, titleLimit) }),
    },
    changes: [
      ...changesOf(
        chart.title,
        [...chart.categories, ...chart.series.map((series) => series.name)],
        [...categories, ...names],
      ),
      ...(axisCuts > 0 ? [`Cut ${count(axisCuts, "axis title")} to ${titleLimit} characters.`] : []),
    ],
  }
}

const check = (input: unknown): Checked => {
  const title = Option.match(decodeTitle(input), { onNone: () => "Untitled chart", onSome: (found) => found.title })
  const decoded = decodeChart(input)
  if (Result.isFailure(decoded))
    return { title, reason: `It is not a valid chart: ${decoded.failure.message.replaceAll(/\s*\n\s*/gu, " ")}` }
  return decoded.success.type === "pie" ? checkPie(title, decoded.success) : checkSeries(title, decoded.success)
}

export const repair = (inputs: ReadonlyArray<unknown>) => {
  const checked = inputs.map(check)
  const valid = checked.filter((each) => "chart" in each)
  const kept = valid.slice(0, chartsPerMessage)
  return {
    charts: kept,
    report: {
      sent: kept.length,
      repaired: kept
        .filter((each) => each.changes.length > 0)
        .map((each) => ({ title: each.title, reason: each.changes.join(" ") })),
      dropped: [
        ...checked.flatMap((each) => ("reason" in each ? [{ title: each.title, reason: each.reason }] : [])),
        ...valid.slice(chartsPerMessage).map((each) => ({
          title: each.title,
          reason: `Slack shows at most ${chartsPerMessage} charts in a message.`,
        })),
      ],
    } satisfies Channel.ChartReport,
  }
}

const blockOf = (chart: Channel.Chart) => ({
  type: "data_visualization",
  title: chart.title,
  chart:
    chart.type === "pie"
      ? { type: "pie", segments: chart.segments }
      : {
          type: chart.type,
          series: chart.series.map((series) => ({
            name: series.name,
            data: chart.categories.map((label, index) => ({ label, value: series.values[index] ?? 0 })),
          })),
          axis_config: {
            categories: chart.categories,
            ...(chart.xLabel && { x_label: chart.xLabel }),
            ...(chart.yLabel && { y_label: chart.yLabel }),
          },
        },
})

export const message = (text: string, charts: ReadonlyArray<Channel.Chart> = []) => ({
  text: fallback(text),
  blocks: [...blocks(text), ...charts.map(blockOf)],
})

export const post = <A>(
  text: string,
  charts: ReadonlyArray<unknown>,
  send: (payload: ReturnType<typeof message>) => Effect.Effect<A, SlackApp.Failed>,
): Effect.Effect<{ readonly answer: A; readonly charts: Option.Option<Channel.ChartReport> }, SlackApp.Failed> => {
  if (charts.length === 0) return send(message(text)).pipe(Effect.map((answer) => ({ answer, charts: Option.none() })))
  const repaired = repair(charts)
  return send(
    message(
      text,
      repaired.charts.map((each) => each.chart),
    ),
  ).pipe(
    Effect.map((answer) => ({ answer, charts: Option.some(repaired.report) })),
    Effect.catchTag("SlackApp.Failed", (error) =>
      repaired.charts.length > 0 && error.error && chartErrors.has(error.error)
        ? Effect.logWarning("Slack refused the charts of a reply; Ren posts the text only", error).pipe(
            Effect.andThen(send(message(text))),
            Effect.map((answer) => ({
              answer,
              charts: Option.some({
                sent: 0,
                repaired: [],
                dropped: [
                  ...repaired.report.dropped,
                  ...repaired.charts.map((each) => ({
                    title: each.title,
                    reason: `Slack refused it: ${error.error}.`,
                  })),
                ],
              }),
            })),
          )
        : Effect.fail(error),
    ),
  )
}

export const delivery = (error: SlackApp.Failed) => {
  if (error.error && goneErrors.has(error.error)) return new ChannelProvider.PlaceGone({ message: error.message })
  if (error.error) return new ChannelProvider.Rejected({ message: error.message })
  return new ChannelProvider.Unavailable({ message: error.message })
}

const ignore = (reason: string) => ({ _tag: "Ignore", reason }) satisfies Channel.Parsed

const unauthorized = (message: string) => new ChannelProvider.Unauthorized({ message })

const kinds: Readonly<Record<string, "channel" | "dm">> = { app_mention: "channel", "message.im": "dm" }

const kindOf = (event: typeof SlackEvent.Type) =>
  kinds[event.type === "message" ? `message.${event.channel_type ?? ""}` : event.type]

const uninstalls = (event: typeof SlackEvent.Type) =>
  event.type === "app_uninstalled" || (event.type === "tokens_revoked" && (event.tokens?.bot ?? []).length > 0)

const ignoredBecause = (bot: string | undefined, event: typeof SlackEvent.Type, kind: "channel" | "dm") => {
  if (event.subtype && !(kind === "dm" && event.subtype === "file_share"))
    return `Slack ${event.type}.${event.subtype} is not handled`
  if (event.bot_id || event.user === bot) return "Slack sent a message from a bot"
  return ""
}

interface Delivery {
  readonly install: string
  readonly bot: string | undefined
  readonly eventId: string
}

const messageOf = (
  delivery: Delivery,
  event: typeof SlackEvent.Type,
  found: { readonly kind: "channel" | "dm"; readonly channel: string; readonly ts: string; readonly user: string },
): Channel.Event => {
  const parsed = SlackMessage.parse(event, delivery.bot)
  return {
    provider: "slack",
    eventId: delivery.eventId,
    install: delivery.install,
    place: { id: found.channel, kind: found.kind },
    thread: { id: `${found.channel}:${event.thread_ts ?? found.ts}` },
    message: found.ts,
    sender: { accountId: `${event.user_team ?? event.team ?? delivery.install}:${found.user}` },
    text: parsed.text,
    files: [...parsed.files],
  }
}

const fromEvent = (delivery: Delivery, event: typeof SlackEvent.Type): Channel.Parsed => {
  if (uninstalls(event)) return { _tag: "Uninstalled", install: delivery.install }
  const kind = kindOf(event)
  if (!kind) return ignore(`Slack ${[event.type, event.channel_type].filter(Boolean).join(".")} is not handled`)
  const reason = ignoredBecause(delivery.bot, event, kind)
  if (reason) return ignore(reason)
  if (!event.channel || !event.ts || !event.user || !delivery.eventId)
    return ignore("Slack sent a message with no channel, timestamp, sender or event id")
  return {
    _tag: "Event",
    event: messageOf(delivery, event, { kind, channel: event.channel, ts: event.ts, user: event.user }),
  }
}

const lookups = 50

const contextMessages = 50

const contextCharacters = 12_000

const contextPages = 10

const omitted = "[earlier messages omitted]"

const accountUser = (accountId: string) => accountId.slice(accountId.indexOf(":") + 1)

const threadOf = (target: ChannelProvider.Target) => {
  const channel = target.thread.slice(0, target.thread.indexOf(":"))
  return { channel, ts: target.thread.slice(channel.length + 1) }
}

const withinCharacters = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  lines.join("\n").length + omitted.length + 1 <= contextCharacters || lines.length === 0
    ? lines
    : withinCharacters(lines.slice(1))

const placeOf = (conversation: typeof Conversation.Type): ChannelProvider.Place => ({
  id: conversation.id,
  name: conversation.name,
  private: conversation.is_private,
  anyoneCanWrite: false,
})

export const make = (app: SlackApp.Client, secrets: ChannelSecrets.Interface): ChannelProvider.Provider => {
  const signing = Redacted.value(app.settings.signingSecret)
  const unavailable = (error: SlackApp.Failed) => new ChannelProvider.Unavailable({ message: error.message })
  const web = new URL(app.settings.web).hostname
  const fileHosts = new Set([web, `files.${web}`])
  const userOf = (token: Redacted.Redacted, id: string) =>
    app.post("users.info", { user: id }, Profile, token).pipe(Effect.map((answer) => answer.user))
  const names = (token: Redacted.Redacted, ids: ReadonlyArray<string>) =>
    Effect.forEach(
      ids.slice(0, lookups),
      (id) =>
        userOf(token, id).pipe(
          Effect.map((found): ReadonlyArray<readonly [string, string]> => [
            [id, found.real_name || found.profile?.real_name || found.name || id],
          ]),
          Effect.orElseSucceed((): ReadonlyArray<readonly [string, string]> => []),
        ),
      { concurrency: 4 },
    ).pipe(Effect.map((found) => new Map(found.flat())))
  const channelNames = (token: Redacted.Redacted, ids: ReadonlyArray<string>) =>
    Effect.forEach(
      [...new Set(ids)].slice(0, lookups),
      (id) =>
        app.post("conversations.info", { channel: id }, Info, token).pipe(
          Effect.map((answer): ReadonlyArray<readonly [string, string]> => [[id, answer.channel.name]]),
          Effect.orElseSucceed((): ReadonlyArray<readonly [string, string]> => []),
        ),
      { concurrency: 4 },
    ).pipe(Effect.map((found) => new Map(found.flat())))
  const tokenOf = (workspace: string) =>
    secrets.ofWorkspace("slack", workspace).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(new ChannelProvider.Unavailable({ message: `Ren holds no Slack token for ${workspace}` })),
          onSome: (found) => Effect.succeed(found.secret),
        }),
      ),
    )
  return {
    id: "slack",
    triggers: [],
    replyTool: "slack_reply_to_current_thread",
    verify: Effect.fnUntraced(function* (request) {
      const timestamp = request.headers.get("x-slack-request-timestamp") ?? ""
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000)
      if (!/^\d+$/u.test(timestamp) || Math.abs(now - Number(timestamp)) > signatureAge)
        return yield* unauthorized("The Slack request timestamp is missing or more than 5 minutes off")
      const given = Buffer.from(request.headers.get("x-slack-signature") ?? "")
      const expected = Buffer.from(
        `v0=${createHmac("sha256", signing).update(`v0:${timestamp}:${request.body}`).digest("hex")}`,
      )
      if (given.length !== expected.length || !timingSafeEqual(given, expected))
        return yield* unauthorized("The signature does not match the body")
    }),
    parse: Effect.fnUntraced(function* (request) {
      const body = yield* decodeEnvelope(request.body).pipe(
        Effect.mapError((error) => new ChannelProvider.Malformed({ message: error.message })),
      )
      if (body.type === "url_verification")
        return { _tag: "Handshake", body: { challenge: body.challenge ?? "" } } satisfies Channel.Parsed
      if (body.type !== "event_callback" || !body.event) return ignore(`Slack ${body.type} is not handled`)
      const install = body.authorizations?.at(0)?.team_id ?? body.team_id
      if (!install) return yield* new ChannelProvider.Malformed({ message: "Slack sent an event with no team" })
      return fromEvent({ install, bot: body.authorizations?.at(0)?.user_id, eventId: body.event_id ?? "" }, body.event)
    }),
    enrich: (event) =>
      Effect.gen(function* () {
        const found = yield* secrets.ofWorkspace("slack", event.install)
        const references = SlackMessage.references(event.text)
        if (Option.isNone(found))
          return Struct.evolve(event, { text: (text) => SlackMessage.named(text, new Map(), new Map()) })
        const token = found.value.secret
        const looked = yield* Effect.all(
          {
            people: names(token, references.users),
            channels: channelNames(token, [
              ...references.channels,
              ...(event.place.kind === "channel" ? [event.place.id] : []),
            ]),
            sender: userOf(token, accountUser(event.sender.accountId)).pipe(Effect.option),
            link: app
              .post(
                "chat.getPermalink",
                { channel: event.place.id, message_ts: event.thread.id.slice(event.thread.id.indexOf(":") + 1) },
                Permalink,
                token,
              )
              .pipe(Effect.option),
          },
          { concurrency: 4 },
        )
        const place = looked.channels.get(event.place.id)
        const sender = Option.getOrUndefined(looked.sender)
        const name = sender?.real_name || sender?.profile?.real_name
        return Struct.evolve(event, {
          text: (text) => SlackMessage.named(text, looked.people, looked.channels),
          place: (current) => ({ ...current, ...(place && { name: place }) }),
          thread: (current) => ({
            ...current,
            ...Option.match(looked.link, { onNone: () => ({}), onSome: (link) => ({ url: link.permalink }) }),
          }),
          sender: (current) => ({ ...current, ...(name && { name }), ...(sender?.name && { handle: sender.name }) }),
        })
      }),
    fetchFile: Effect.fn("Slack.fetchFile")(function* (install, file) {
      if ((file.size ?? 0) > SlackApp.maxFileBytes)
        return yield* new ChannelProvider.FileUnavailable({
          message: `Slack file ${file.name} exceeds the 32 MiB limit`,
        })
      const url = URL.parse(file.url)
      if (!url || !fileHosts.has(url.hostname))
        return yield* new ChannelProvider.FileUnavailable({ message: `Slack sent ${file.name} from outside Slack` })
      const token = yield* tokenOf(install).pipe(
        Effect.mapError((error) => new ChannelProvider.FileUnavailable({ message: error.message })),
      )
      return yield* app
        .download(file.url, token)
        .pipe(Effect.mapError((error) => new ChannelProvider.FileUnavailable({ message: error.message })))
    }),
    linkOf: (event) =>
      event.place.kind === "dm"
        ? Option.none()
        : Option.some({ kind: "slack_thread", key: event.thread.id.toUpperCase() } satisfies TaskLink.Ref),
    context: Effect.fn("Slack.context")(
      function* (event) {
        const found = yield* secrets.ofWorkspace("slack", event.install)
        if (Option.isNone(found)) return Option.none<string>()
        const token = found.value.secret
        const bot = found.value.botUser ?? undefined
        const root = event.thread.id.slice(event.thread.id.indexOf(":") + 1)
        const pages = yield* Stream.paginate({ cursor: "", page: 1 }, (state) =>
          app
            .post(
              "conversations.replies",
              {
                channel: event.place.id,
                ts: root,
                latest: event.message,
                limit: 200,
                ...(state.cursor && { cursor: state.cursor }),
              },
              Replies,
              token,
            )
            .pipe(
              Effect.map((answer) => {
                const cursor = answer.response_metadata?.next_cursor
                return [
                  [answer],
                  cursor && state.page < contextPages ? Option.some({ cursor, page: state.page + 1 }) : Option.none(),
                ] as const
              }),
            ),
        ).pipe(Stream.runCollect)
        if (pages.at(-1)?.response_metadata?.next_cursor)
          return Option.some("[Thread context omitted: the pagination limit was reached before the current message.]")
        const before = pages.flatMap((page) => page.messages).filter((each) => Number(each.ts) < Number(event.message))
        const previous = before.findLastIndex(
          (each) => Boolean(bot) && each.user !== bot && (each.text ?? "").includes(`<@${bot}>`),
        )
        const bodies = before.slice(previous + 1).flatMap((each) => {
          const text = each.user === bot ? "" : SlackMessage.parse(each, bot).text
          return text ? [{ author: each.user ?? each.bot_id ?? "unknown", text }] : []
        })
        const kept = bodies.slice(-contextMessages)
        const mentioned = kept.map((each) => SlackMessage.references(each.text))
        const people = yield* names(token, [
          ...new Set([...kept.map((each) => each.author), ...mentioned.flatMap((each) => each.users)]),
        ])
        const channels = yield* channelNames(token, [...new Set(mentioned.flatMap((each) => each.channels))])
        const lines = withinCharacters(
          kept.map(
            (each) => `[${people.get(each.author) ?? each.author}] ${SlackMessage.named(each.text, people, channels)}`,
          ),
        )
        if (lines.length === 0) return Option.none<string>()
        return Option.some([...(lines.length < bodies.length ? [omitted] : []), ...lines].join("\n"))
      },
      Effect.mapError((error) => new ChannelProvider.Unavailable({ message: error.message })),
    ),
    send: Effect.fn("Slack.send")(function* (target, text, charts = []) {
      const token = yield* tokenOf(target.install)
      const thread = threadOf(target)
      const sent = yield* post(text, charts, (payload) =>
        app.post("chat.postMessage", { channel: thread.channel, thread_ts: thread.ts, ...payload }, Posted, token),
      ).pipe(Effect.mapError(delivery))
      return sent.charts
    }),
    progress: Effect.fn("Slack.progress")(function* (target, status) {
      const token = yield* tokenOf(target.install)
      const react = (method: "reactions.add" | "reactions.remove", name: string) =>
        app
          .post(method, { channel: threadOf(target).channel, timestamp: target.message, name }, Answered, token)
          .pipe(
            Effect.catchTag("SlackApp.Failed", (error) =>
              error.error && settledReactions.has(error.error) ? Effect.void : Effect.fail(unavailable(error)),
            ),
          )
      if (status === "received") return yield* react("reactions.add", "eyes")
      yield* react("reactions.remove", "eyes")
      yield* react("reactions.add", status === "done" ? "white_check_mark" : "x")
    }),
    email: (install, sender) =>
      tokenOf(install).pipe(
        Effect.flatMap((token) =>
          userOf(token, accountUser(sender.accountId)).pipe(
            Effect.map((found) => Option.fromNullishOr(found.profile?.email)),
            Effect.catchTag("SlackApp.Failed", (error) =>
              error.error === "user_not_found" ? Effect.succeedNone : Effect.fail(unavailable(error)),
            ),
          ),
        ),
      ),
    installUrl: (state, accounts) => {
      const url = new URL(`${app.settings.web}/oauth/v2/authorize`)
      url.searchParams.set("client_id", app.settings.clientId)
      url.searchParams.set("scope", SlackApp.botScopes.join(","))
      url.searchParams.set("redirect_uri", app.settings.redirectUri)
      url.searchParams.set("state", state)
      const team = accounts.at(0)?.split(":").at(0)
      if (team) url.searchParams.set("team", team)
      return url.toString()
    },
    completeInstall: Effect.fnUntraced(function* (query, accounts) {
      if (query.error === "access_denied")
        return yield* new ChannelProvider.InstallFailed({ message: "The install was cancelled in Slack." })
      if (query.error)
        return yield* new ChannelProvider.InstallFailed({ message: `Slack refused the install: ${query.error}.` })
      if (!query.code) return yield* new ChannelProvider.InstallFailed({ message: "Slack sent no code." })
      const answer = yield* app
        .post(
          "oauth.v2.access",
          {
            client_id: app.settings.clientId,
            client_secret: Redacted.value(app.settings.clientSecret),
            code: query.code,
            redirect_uri: app.settings.redirectUri,
          },
          Access,
        )
        .pipe(
          Effect.catchTag("SlackApp.Failed", (error) =>
            Effect.logWarning("A Slack install could not be confirmed", error).pipe(
              Effect.andThen(
                Effect.fail(
                  new ChannelProvider.InstallFailed({ message: "Slack did not confirm the install. Try again." }),
                ),
              ),
            ),
          ),
        )
      const team = answer.team.id
      const installer = answer.authed_user?.id ? `${team}:${answer.authed_user.id}` : undefined
      const signedIn = accounts.filter((account) => account.startsWith(`${team}:`))
      if (signedIn.length > 0 && !(installer && signedIn.includes(installer)))
        return yield* new ChannelProvider.InstallFailed({
          message:
            "You installed Ren as another Slack user than the one you signed in with. Sign in to Slack as yourself, then install again.",
        })
      return {
        workspace: team,
        name: answer.team.name ?? team,
        botUser: answer.bot_user_id,
        secret: Redacted.make(answer.access_token),
        ...(installer && { installer: { accountId: installer } }),
      } satisfies ChannelProvider.Installed
    }),
    changedOnProvider: () => false,
    revoke: Effect.fn("Slack.revoke")(function* (workspace) {
      const found = yield* secrets.ofWorkspace("slack", workspace)
      if (Option.isNone(found)) return
      yield* app
        .post("auth.revoke", {}, Revoked, found.value.secret)
        .pipe(
          Effect.catchTag("SlackApp.Failed", (error) =>
            error.error && revokedErrors.has(error.error) ? Effect.void : Effect.fail(unavailable(error)),
          ),
        )
    }),
    places: Effect.fn("Slack.places")(function* (workspace) {
      const token = yield* tokenOf(workspace)
      return yield* Stream.paginate({ cursor: "", page: 1 }, (state) =>
        Effect.gen(function* () {
          const answer = yield* app.post(
            "conversations.list",
            {
              types: "public_channel,private_channel",
              exclude_archived: true,
              limit: 200,
              ...(state.cursor && { cursor: state.cursor }),
            },
            Conversations,
            token,
          )
          const cursor = answer.response_metadata?.next_cursor
          if (cursor && state.page >= maxPages)
            return yield* new SlackApp.Failed({
              message: `Slack has more than ${maxPages} pages of channels; Ren lists none`,
            })
          return [
            answer.channels.map(placeOf),
            cursor ? Option.some({ cursor, page: state.page + 1 }) : Option.none(),
          ] as const
        }),
      ).pipe(Stream.runCollect, Effect.mapError(unavailable))
    }),
    place: Effect.fn("Slack.place")(function* (workspace, id) {
      const token = yield* tokenOf(workspace)
      return yield* app.post("conversations.info", { channel: id }, Info, token).pipe(
        Effect.map((answer) => Option.some(placeOf(answer.channel))),
        Effect.catchTag("SlackApp.Failed", (error) =>
          error.error === "channel_not_found" ? Effect.succeedNone : Effect.fail(unavailable(error)),
        ),
      )
    }),
    announce: Effect.fn("Slack.announce")(function* (workspace, place, text) {
      const token = yield* tokenOf(workspace)
      yield* app.post("chat.postMessage", { channel: place.id, text }, Posted, token).pipe(Effect.mapError(delivery))
    }),
  }
}

export const provider = Effect.gen(function* () {
  const slack = yield* SlackApp.Service
  const secrets = yield* ChannelSecrets.Service
  return Option.map(slack.client, (client) => make(client, secrets))
})
