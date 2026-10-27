import { GitHubAccounts } from "@ren/core/github-accounts"
import { SlackApp } from "@ren/core/slack-app"
import type { Auth } from "@ren/schema/auth"
import { Effect, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"

export const SignInHandler = HttpApiBuilder.group(Api, "sign-in", (handlers) =>
  Effect.gen(function* () {
    const accounts = yield* GitHubAccounts.Service
    const slack = yield* SlackApp.Service
    const items: ReadonlyArray<Auth.SignInProvider> = [
      "google",
      ...(Option.isSome(accounts.signIn) ? (["github"] as const) : []),
      ...(Option.isSome(slack.client) ? (["slack"] as const) : []),
    ]
    return handlers.handle("sign-in-provider.list", () => Effect.succeed({ items }))
  }),
)
