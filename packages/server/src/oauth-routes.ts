export * as OAuthRoutes from "./oauth-routes.js"

import { OAuth } from "@ren/core/oauth"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { Auth } from "./auth.js"

const escape = (text: string) => text.replaceAll(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`)

const page = (title: string, message: string) =>
  HttpServerResponse.html(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title></head><body><h1>${escape(title)}</h1><p>${escape(message)}</p><script>setTimeout(() => window.close(), 1500)</script></body></html>`,
  )

// oxlint-disable-next-line ren/no-comments -- owner-access §8 and §9 rule 3: the callback has no login check, because `state` is the authentication; a browser session must be the initiator's. The client metadata document lets a server that supports it take Ren's client without a registration (A33).
// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const oauth = yield* OAuth.Service
    const auth = yield* Auth.Service
    yield* router.add(
      "GET",
      "/oauth/client.json",
      Effect.map(oauth.clientMetadata, (body) => HttpServerResponse.jsonUnsafe(body)),
    )
    yield* router.add("GET", "/oauth/callback", (request) =>
      Effect.gen(function* () {
        const url = new URL(request.url, "http://ren")
        const params = url.searchParams
        const read = (name: string) => Option.getOrUndefined(Option.fromNullishOr(params.get(name)))
        const state = read("state")
        if (!state) return page("Sign-in failed", "The address has no sign-in state.")
        const session = yield* auth.getSession(new Headers(request.headers))
        const code = read("code")
        const iss = read("iss")
        const error = read("error")
        const errorDescription = read("error_description")
        const outcome = yield* oauth.callback(
          {
            state,
            ...(code && { code }),
            // ast-grep-ignore: no-nullish-comparison, -- an empty `iss` is present and must fail the issuer check (K7)
            ...(iss !== undefined && { iss }),
            ...(error && { error }),
            ...(errorDescription && { errorDescription }),
          },
          Option.map(session, (found) => found.user.id),
        )
        if (!outcome.ok) return page("Sign-in failed", outcome.reason)
        return page(
          "Connected",
          Option.match(outcome.sameAccountAs, {
            onNone: () => `${outcome.label} is connected. You can close this tab.`,
            onSome: (name) => `This is the same account as ${name}.`,
          }),
        )
      }),
    )
  }),
)
