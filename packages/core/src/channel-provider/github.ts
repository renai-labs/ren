export * as GitHub from "./github.js"

import type { Channel } from "@ren/schema/channel"
import { Effect, Option, Redacted, Schema } from "effect"
import { createHmac, timingSafeEqual } from "node:crypto"
import { ChannelProvider } from "../channel-provider.js"
import { GitHubApp } from "../github-app.js"

const Body = Schema.fromJsonString(
  Schema.Struct({
    action: Schema.optionalKey(Schema.String),
    installation: Schema.optionalKey(Schema.Struct({ id: Schema.Number })),
  }),
)

const decodeBody = Schema.decodeUnknownEffect(Body)

export const make = (app: GitHubApp.Client): ChannelProvider.Provider => {
  const secret = Redacted.value(app.settings.webhookSecret)
  return {
    id: "github",
    verify: (request) => {
      const given = Buffer.from(request.headers.get("x-hub-signature-256") ?? "")
      const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(request.body).digest("hex")}`)
      return given.length === expected.length && timingSafeEqual(given, expected)
        ? Effect.void
        : Effect.fail(new ChannelProvider.Unauthorized({ message: "The signature does not match the body" }))
    },
    parse: (request) =>
      decodeBody(request.body).pipe(
        Effect.mapError((error) => new ChannelProvider.Malformed({ message: error.message })),
        Effect.map((body): Channel.Parsed => {
          const event = request.headers.get("x-github-event") ?? ""
          if (event === "ping") return { _tag: "Handshake", body: {} }
          if (event === "installation" && body.action === "deleted" && body.installation)
            return { _tag: "Uninstalled", install: String(body.installation.id) }
          return { _tag: "Ignore", reason: `GitHub ${[event, body.action].filter(Boolean).join(".")} is not handled` }
        }),
      ),
    fetchFile: () => Effect.fail(new ChannelProvider.FileUnavailable({ message: "GitHub events carry no files" })),
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
