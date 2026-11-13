import { PgClient } from "@effect/sql-pg"
import { ChannelSecrets } from "@ren/core/channel-secrets"
import { Envelope } from "@ren/core/envelope"
import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import { isValidSlackRequest, webApi, type EnvelopedEvent, type types } from "@slack/bolt"
import { Effect, Layer, Redacted, Schema } from "effect"
import { createHmac } from "node:crypto"
import { parseArgs } from "node:util"

const usage = `Usage:
  bun slack-event.ts install --email <user> --space <space id> --channel <channel id>
    Installs the dev Slack app (SLACK_DEV_BOT_TOKEN) in the user's organization and maps the channel
    to the space. Needs DATABASE_URL and ENVELOPE_KEYS of the running server.
  bun slack-event.ts mention --server <url> --channel <channel id> --user <Slack user id> --text <text> [--thread <ts>]
    Sends an app_mention event to the server, signed as Slack signs it. Needs SLACK_SIGNING_SECRET.`

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: "string" },
    space: { type: "string" },
    channel: { type: "string" },
    server: { type: "string" },
    user: { type: "string" },
    text: { type: "string" },
    thread: { type: "string" },
  },
})

const required = (name: string, value: string | undefined) => {
  if (value) return value
  console.error(`Missing ${name}.\n\n${usage}`)
  return process.exit(2)
}

const slack = new webApi.WebClient(required("SLACK_DEV_BOT_TOKEN", process.env.SLACK_DEV_BOT_TOKEN))

const identity = async () => {
  const auth = await slack.auth.test()
  const bot = await slack.bots.info({ bot: required("the bot id from auth.test", auth.bot_id) })
  return {
    team: required("the team id from auth.test", auth.team_id),
    teamName: required("the team name from auth.test", auth.team),
    botUser: required("the bot user from auth.test", auth.user_id),
    app: required("the app id from bots.info", bot.bot?.app_id),
  }
}

const install = async () => {
  const email = required("--email", values.email)
  const spaceId = required("--space", values.space)
  const channel = required("--channel", values.channel)
  const databaseURL = required("DATABASE_URL", process.env.DATABASE_URL)
  const app = await identity()
  const place = required("the channel name", (await slack.conversations.info({ channel })).channel?.name)
  const reader = new Bun.SQL(databaseURL)
  const Found = Schema.Array(Schema.Struct({ userId: Schema.String, organizationId: Auth.OrganizationID }))
  const found = Schema.decodeUnknownSync(Found)(
    await reader`select "user".id as "userId", member.organization_id as "organizationId" from "user" join member on member.user_id = "user".id where "user".email = ${email}`,
  ).at(0)
  await reader.close()
  if (!found) {
    console.error(`No member with the email ${email}`)
    return process.exit(1)
  }
  const installId = ChannelInstall.ID.create()
  const database = Database.layer.pipe(Layer.provide(PgClient.layer({ url: Redacted.make(databaseURL) })))
  const secret = await Effect.runPromise(
    Effect.flatMap(ChannelSecrets.Service, (secrets) =>
      secrets.seal(
        found.organizationId,
        installId,
        Redacted.make(required("SLACK_DEV_BOT_TOKEN", process.env.SLACK_DEV_BOT_TOKEN)),
      ),
    ).pipe(Effect.provide(ChannelSecrets.layer.pipe(Layer.provide([database, Envelope.layerLocal])))),
  )
  const writer = new Bun.SQL(databaseURL)
  await writer`insert into channel_install (id, organization_id, provider, workspace, name, bot_user, secret, installed_by, default_space_id)
    values (${installId}, ${found.organizationId}, 'slack', ${app.team}, ${app.teamName}, ${app.botUser}, ${secret}, ${found.userId}, ${spaceId})`
  await writer`insert into channel_mapping (id, install_id, place, place_name, space_id, created_by)
    values (${ChannelMapping.ID.create()}, ${installId}, ${channel}, ${place}, ${spaceId}, ${found.userId})`
  await writer.close()
  console.log(JSON.stringify({ installId, workspace: app.team, botUser: app.botUser, channel: place }, null, 2))
}

const mention = async () => {
  const server = required("--server", values.server)
  const signingSecret = required("SLACK_SIGNING_SECRET", process.env.SLACK_SIGNING_SECRET)
  const app = await identity()
  const now = Date.now()
  const ts = `${Math.floor(now / 1000)}.${String(now % 1000).padStart(6, "0")}`
  const event: types.AppMentionEvent = {
    type: "app_mention",
    user: required("--user", values.user),
    text: `<@${app.botUser}> ${required("--text", values.text)}`,
    channel: required("--channel", values.channel),
    team: app.team,
    ts,
    event_ts: ts,
    ...(values.thread && { thread_ts: values.thread }),
  }
  const envelope: EnvelopedEvent<types.AppMentionEvent> = {
    token: "",
    team_id: app.team,
    api_app_id: app.app,
    type: "event_callback",
    event_id: `Ev${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
    event_time: Math.floor(now / 1000),
    event,
    authorizations: [{ enterprise_id: null, team_id: app.team, user_id: app.botUser, is_bot: true }],
  }
  const body = JSON.stringify(envelope)
  const timestamp = Math.floor(now / 1000)
  const signature = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`
  if (
    !isValidSlackRequest({
      signingSecret,
      body,
      headers: { "x-slack-signature": signature, "x-slack-request-timestamp": timestamp },
    })
  ) {
    console.error("Bolt does not accept the signature")
    return process.exit(1)
  }
  const response = await fetch(`${server}/channels/slack`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": signature,
    },
    body,
  })
  console.log(JSON.stringify({ status: response.status, body: await response.text(), ts }, null, 2))
}

if (positionals[0] === "install") await install()
else if (positionals[0] === "mention") await mention()
else {
  console.error(usage)
  process.exit(2)
}
