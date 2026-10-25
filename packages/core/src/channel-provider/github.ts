export * as GitHub from "./github.js"

import type { Channel } from "@ren/schema/channel"
import { Effect, Option, Redacted, Schema } from "effect"
import { createHmac, timingSafeEqual } from "node:crypto"
import { ChannelProvider } from "../channel-provider.js"
import { GitHubApp } from "../github-app.js"

const Envelope = Schema.Struct({
  action: Schema.optionalKey(Schema.String),
  installation: Schema.optionalKey(Schema.Struct({ id: Schema.Number })),
})

const Item = Schema.Struct({ number: Schema.Number, html_url: Schema.String })

const Comment = Schema.Struct({
  action: Schema.String,
  installation: Schema.Struct({ id: Schema.Number }),
  sender: Schema.Struct({ id: Schema.Number, login: Schema.String, type: Schema.String }),
  repository: Schema.Struct({ id: Schema.Number, full_name: Schema.String }),
  comment: Schema.Struct({ id: Schema.Number, body: Schema.String }),
  changes: Schema.optionalKey(Schema.Struct({ body: Schema.optionalKey(Schema.Struct({ from: Schema.String })) })),
  issue: Schema.optionalKey(Item),
  pull_request: Schema.optionalKey(Item),
})

const Issue = Schema.Struct({
  title: Schema.String,
  state: Schema.String,
  pull_request: Schema.optionalKey(Schema.Struct({})),
})

const Pull = Schema.Struct({
  title: Schema.String,
  state: Schema.String,
  draft: Schema.optionalKey(Schema.Boolean),
  merged: Schema.optionalKey(Schema.Boolean),
  head: Schema.Struct({ ref: Schema.String }),
  base: Schema.Struct({ ref: Schema.String }),
})

const Author = Schema.Struct({ user: Schema.NullOr(Schema.Struct({ login: Schema.String })) })

const commentEvents: Readonly<Record<string, "issue" | "review">> = {
  issue_comment: "issue",
  pull_request_review_comment: "review",
}

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

const decodeEnvelope = Schema.decodeUnknownEffect(Envelope)

const decodeComment = Schema.decodeUnknownEffect(Comment)

const malformed = (error: Schema.SchemaError) => new ChannelProvider.Malformed({ message: error.message })

const ignore = (reason: string) => ({ _tag: "Ignore", reason }) satisfies Channel.Parsed

const stateOf = (pull: typeof Pull.Type) => {
  if (pull.merged) return "merged"
  if (pull.draft && pull.state === "open") return "draft"
  return pull.state
}

export const make = (app: GitHubApp.Client): ChannelProvider.Provider => {
  const secret = Redacted.value(app.settings.webhookSecret)
  const mention = new RegExp(`(?<![\\w-])@${app.settings.slug}(?:\\[bot\\])?(?![\\w-])`, "iu")
  const mentions = (text: string) => mention.test(text)
  const web = new URL(app.settings.web)
  const webUrl = (value: string) => {
    const url = URL.parse(value)
    return url?.protocol === "https:" && url.host === web.host && !url.username && !url.password ? value : undefined
  }
  const addsMention = (body: typeof Comment.Type) =>
    mentions(body.comment.body) &&
    (body.action === "created" ||
      (body.action === "edited" && !mentions(body.changes?.body?.from ?? body.comment.body)))
  const fromComment = (input: {
    readonly event: string
    readonly kind: "issue" | "review"
    readonly delivery: string
    readonly body: typeof Comment.Type
  }): Channel.Parsed => {
    const body = input.body
    const item = body.issue ?? body.pull_request
    if (!item) return ignore(`GitHub ${input.event} names no issue or pull request`)
    if (body.sender.type === "Bot" || String(body.sender.id) === app.settings.botUserId)
      return ignore(`GitHub ${input.event} is from the bot ${body.sender.login}`)
    if (!addsMention(body)) return ignore(`GitHub ${input.event}.${body.action} adds no mention of Ren`)
    const url = webUrl(item.html_url)
    return {
      _tag: "Event",
      event: {
        provider: "github",
        eventId: input.delivery,
        install: String(body.installation.id),
        place: { id: String(body.repository.id), kind: "repository", name: body.repository.full_name },
        thread: { id: `${body.repository.id}:${item.number}`, ...(url && { url }) },
        message: `${input.kind}:${body.comment.id}`,
        sender: { accountId: String(body.sender.id), handle: body.sender.login },
        text: body.comment.body,
        files: [],
      },
    }
  }
  return {
    id: "github",
    verify: (request) => {
      const given = Buffer.from(request.headers.get("x-hub-signature-256") ?? "")
      const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(request.body).digest("hex")}`)
      return given.length === expected.length && timingSafeEqual(given, expected)
        ? Effect.void
        : Effect.fail(new ChannelProvider.Unauthorized({ message: "The signature does not match the body" }))
    },
    parse: Effect.fnUntraced(function* (request) {
      const event = request.headers.get("x-github-event") ?? ""
      const body = yield* decodeJson(request.body).pipe(Effect.mapError(malformed))
      const envelope = yield* decodeEnvelope(body).pipe(Effect.mapError(malformed))
      if (event === "ping") return { _tag: "Handshake", body: {} } satisfies Channel.Parsed
      if (event === "installation" && envelope.action === "deleted" && envelope.installation)
        return { _tag: "Uninstalled", install: String(envelope.installation.id) } satisfies Channel.Parsed
      const kind = commentEvents[event]
      if (!kind) return ignore(`GitHub ${[event, envelope.action].filter(Boolean).join(".")} is not handled`)
      const delivery = request.headers.get("x-github-delivery")
      if (!delivery) return yield* new ChannelProvider.Malformed({ message: "GitHub sent no X-GitHub-Delivery" })
      return yield* decodeComment(body).pipe(
        Effect.map((comment) => fromComment({ event, kind, delivery, body: comment })),
        Effect.orElseSucceed(() => ignore(`GitHub ${event} has no sender, installation, repository or comment`)),
      )
    }),
    fetchFile: () => Effect.fail(new ChannelProvider.FileUnavailable({ message: "GitHub events carry no files" })),
    context: Effect.fn("GitHub.context")(
      function* (event) {
        const repository = (event.place.name ?? "").split("/").map(encodeURIComponent).join("/")
        const number = event.thread.id.split(":").at(1) ?? ""
        const kind = event.message.startsWith("review:") ? "review" : "issue"
        const comment = event.message.slice(kind.length + 1)
        const read = <S extends Schema.Top>(path: string, schema: S) =>
          app.read(event.install, `/repos/${repository}${path}`, schema)
        const found = yield* Effect.all(
          {
            issue: read(`/issues/${number}`, Issue),
            comment: read(kind === "review" ? `/pulls/comments/${comment}` : `/issues/comments/${comment}`, Author),
          },
          { concurrency: 2 },
        )
        const issue = found.issue
        const author = found.comment.user ? ` by @${found.comment.user.login}` : ""
        const triggering = `Triggering comment: ${comment} (${kind})${author}`
        if (!issue.pull_request) return Option.some(`Issue #${number} “${issue.title}”, ${issue.state}\n${triggering}`)
        const pull = yield* read(`/pulls/${number}`, Pull)
        return Option.some(
          `Pull request #${number} “${pull.title}”, ${stateOf(pull)}, ${pull.head.ref} → ${pull.base.ref}\n${triggering}`,
        )
      },
      Effect.mapError((error) => new ChannelProvider.Unavailable({ message: error.message })),
    ),
    installUrl: app.installUrl,
    completeInstall: Effect.fnUntraced(function* (query) {
      if (query.setup_action === "request")
        return yield* new ChannelProvider.InstallFailed({
          message: "An owner of the GitHub account has to approve the install. Install again after they approve it.",
        })
      const installationId = query.installation_id ?? ""
      if (!/^\d+$/u.test(installationId))
        return yield* new ChannelProvider.InstallFailed({ message: "GitHub sent no installation." })
      if (!query.code)
        return yield* new ChannelProvider.InstallFailed({
          message:
            "GitHub sent no user authorization. Turn on “Request user authorization (OAuth) during installation” in the GitHub App.",
        })
      const unavailable = (error: GitHubApp.Failed) =>
        Effect.logWarning("A GitHub install could not be checked", error).pipe(
          Effect.andThen(
            Effect.fail(
              new ChannelProvider.InstallFailed({ message: "GitHub did not confirm the install. Try again." }),
            ),
          ),
        )
      const reachable = yield* app
        .exchangeCode(query.code)
        .pipe(Effect.flatMap(app.userInstallations), Effect.catchTag("GitHubApp.Failed", unavailable))
      if (!reachable.includes(installationId))
        return yield* new ChannelProvider.InstallFailed({
          message: "Your GitHub account cannot reach this installation.",
        })
      const installation = yield* app
        .installation(installationId)
        .pipe(Effect.catchTag("GitHubApp.Failed", unavailable))
      return {
        workspace: installationId,
        name: installation.account?.login ?? installationId,
        botUser: app.settings.botUserId,
      }
    }),
    changedOnProvider: (query) => query.setup_action === "update" && !query.state,
    revoke: (workspace) =>
      app
        .deleteInstallation(workspace)
        .pipe(Effect.mapError((error) => new ChannelProvider.Unavailable({ message: error.message }))),
  }
}

export const provider = Effect.gen(function* () {
  const settings = yield* GitHubApp.settings
  if (Option.isNone(settings)) return Option.none<ChannelProvider.Provider>()
  return Option.some(make(yield* GitHubApp.make(settings.value)))
})
