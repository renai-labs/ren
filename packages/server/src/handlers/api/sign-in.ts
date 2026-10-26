import { GitHubAccounts } from "@ren/core/github-accounts"
import { Effect, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"

export const SignInHandler = HttpApiBuilder.group(Api, "sign-in", (handlers) =>
  Effect.gen(function* () {
    const accounts = yield* GitHubAccounts.Service
    return handlers.handle("sign-in-provider.list", () =>
      Effect.succeed({
        items: Option.isSome(accounts.signIn) ? (["google", "github"] as const) : (["google"] as const),
      }),
    )
  }),
)
