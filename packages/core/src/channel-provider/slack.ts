export * as Slack from "./slack.js"

import type { Channel } from "@ren/schema/channel"
import { Clock, Effect, Option, Redacted, Schema, Stream } from "effect"
import { createHmac, timingSafeEqual } from "node:crypto"
import { ChannelProvider } from "../channel-provider.js"
import { ChannelSecrets } from "../channel-secrets.js"
import { SlackApp } from "../slack-app.js"

const Envelope = Schema.Struct({
  type: Schema.String,
  challenge: Schema.optionalKey(Schema.String),
  team_id: Schema.optionalKey(Schema.String),
  authorizations: Schema.optionalKey(Schema.Array(Schema.Struct({ team_id: Schema.NullOr(Schema.String) }))),
  event: Schema.optionalKey(
    Schema.Struct({
      type: Schema.String,
      tokens: Schema.optionalKey(Schema.Struct({ bot: Schema.optionalKey(Schema.Array(Schema.String)) })),
    }),
  ),
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

const decodeEnvelope = Schema.decodeUnknownEffect(Schema.fromJsonString(Envelope))

const signatureAge = 5 * 60

const maxPages = 25

const goneErrors = new Set(["channel_not_found", "not_in_channel", "is_archived"])

const revokedErrors = new Set(["invalid_auth", "token_revoked", "account_inactive", "not_authed"])

const ignore = (reason: string) => ({ _tag: "Ignore", reason }) satisfies Channel.Parsed

const unauthorized = (message: string) => new ChannelProvider.Unauthorized({ message })

const fromEvent = (install: string, event: NonNullable<typeof Envelope.Type.event>): Channel.Parsed => {
  if (event.type === "app_uninstalled" || (event.type === "tokens_revoked" && (event.tokens?.bot ?? []).length > 0))
    return { _tag: "Uninstalled", install }
  return ignore(`Slack ${event.type} is not handled`)
}

const placeOf = (conversation: typeof Conversation.Type): ChannelProvider.Place => ({
  id: conversation.id,
  name: conversation.name,
  private: conversation.is_private,
  anyoneCanWrite: false,
})

export const make = (app: SlackApp.Client, secrets: ChannelSecrets.Interface): ChannelProvider.Provider => {
  const signing = Redacted.value(app.settings.signingSecret)
  const unavailable = (error: SlackApp.Failed) => new ChannelProvider.Unavailable({ message: error.message })
  const later = (what: string) => new ChannelProvider.Unavailable({ message: `Slack ${what} are not handled yet` })
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
      return fromEvent(install, body.event)
    }),
    fetchFile: () => Effect.fail(new ChannelProvider.FileUnavailable({ message: "Slack files are not handled yet" })),
    linkOf: () => Option.none(),
    context: () => Effect.fail(later("threads")),
    send: () => Effect.fail(later("replies")),
    progress: () => Effect.fail(later("reactions")),
    email: () => Effect.fail(later("senders")),
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
      yield* app.post("chat.postMessage", { channel: place.id, text }, Posted, token).pipe(
        Effect.mapError((error) => {
          if (error.error && goneErrors.has(error.error))
            return new ChannelProvider.PlaceGone({ message: error.message })
          if (error.error) return new ChannelProvider.Rejected({ message: error.message })
          return unavailable(error)
        }),
      )
    }),
  }
}

export const provider = Effect.gen(function* () {
  const slack = yield* SlackApp.Service
  const secrets = yield* ChannelSecrets.Service
  return Option.map(slack.client, (client) => make(client, secrets))
})
