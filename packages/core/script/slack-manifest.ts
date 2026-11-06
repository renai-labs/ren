import { parseArgs } from "node:util"
import { Config, Effect, Redacted, Schema } from "effect"
import { SlackManifest } from "../src/slack-manifest.js"

const usage = `Usage:
  bun --env-file=<env file> run slack-manifest [--apply]

Without --apply, the script prints the changes and validates them. It reads:
  SLACK_APP_ID        the Slack app to configure
  SLACK_CONFIG_TOKEN  an app configuration token: api.slack.com/apps, Your App Configuration Tokens
  REN_URL             Ren's server: Slack's events, interactivity and install redirect URLs
  BETTER_AUTH_URL     the Sign in with Slack redirect URL
  APP_URL             the web app, whose host task cards unfurl on`

const args = parseArgs({
  options: { apply: { type: "boolean" }, help: { type: "boolean" } },
})

const Answer = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String, pointer: Schema.String }))),
  manifest: Schema.optionalKey(Schema.JsonObject),
  permissions_updated: Schema.optionalKey(Schema.Boolean),
})

const call = Effect.fnUntraced(function* (
  method: string,
  token: Redacted.Redacted,
  body: Readonly<Record<string, string>>,
) {
  const response = yield* Effect.promise(() =>
    fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { authorization: `Bearer ${Redacted.value(token)}` },
      body: new URLSearchParams(body),
    }).then((answer) => answer.text()),
  )
  const answer = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Answer))(response)
  if (!answer.ok)
    return yield* Effect.die(
      new Error(
        [
          `Slack refused ${method}: ${answer.error ?? "no reason"}`,
          ...(answer.errors ?? []).map((error) => `  ${error.pointer}: ${error.message}`),
        ].join("\n"),
      ),
    )
  return answer
})

const leaves = (value: unknown, path = ""): ReadonlyArray<string> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.entries(value).flatMap((entry) => leaves(entry[1], `${path}/${entry[0]}`))
    : [`${path} = ${JSON.stringify(value)}`]

const program = Effect.gen(function* () {
  if (args.values.help) return yield* Effect.log(usage)
  const config = yield* Config.all({
    appId: Config.String("SLACK_APP_ID"),
    token: Config.Redacted("SLACK_CONFIG_TOKEN"),
    ren: Config.String("REN_URL"),
    auth: Config.String("BETTER_AUTH_URL"),
    app: Config.String("APP_URL"),
  }).pipe(
    Effect.mapError((error) => new Error(`${error.message}\n\n${usage}`)),
    Effect.orDie,
  )
  const exported = yield* call("apps.manifest.export", config.token, { app_id: config.appId })
  const current = exported.manifest ?? {}
  const next = SlackManifest.patch(current, { ren: config.ren, auth: config.auth, app: config.app })
  const before = new Set(leaves(current))
  const after = new Set(leaves(next))
  const changes = [
    ...[...before].filter((line) => !after.has(line)).map((line) => `- ${line}`),
    ...[...after].filter((line) => !before.has(line)).map((line) => `+ ${line}`),
  ]
  yield* Effect.log(changes.length === 0 ? "The manifest is up to date." : changes.join("\n"))
  if (changes.length === 0) return
  const manifest = JSON.stringify(next)
  yield* call("apps.manifest.validate", config.token, { app_id: config.appId, manifest })
  if (!args.values.apply) return yield* Effect.log("The new manifest is valid. Run again with --apply to write it.")
  const updated = yield* call("apps.manifest.update", config.token, { app_id: config.appId, manifest })
  yield* Effect.log(
    updated.permissions_updated
      ? "Updated. The scopes changed: each workspace must install Ren again."
      : "Updated. The scopes did not change.",
  )
})

await Effect.runPromise(program)
