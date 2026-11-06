export * as OAuthRoutes from "./oauth-routes.js"

import { OAuth } from "@ren/core/oauth"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { Auth } from "./auth.js"

const escape = (text: string) => text.replaceAll(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`)

const reasons: Readonly<Record<string, string>> = {
  "StateInvalid: expired": "The sign-in expired.",
  "StateInvalid: used": "This sign-in was already used.",
  "StateInvalid: unknown": "Ren does not know this sign-in.",
  "StateInvalid: other_user": "You are signed in to Ren as another person.",
}

const fill = (template: string, values: Readonly<Record<string, string>>) =>
  template.replaceAll(/\{\{(\w+)\}\}/gu, (whole, key: string) => values[key] ?? whole)

const page = (
  template: string,
  input: {
    readonly ok: boolean
    readonly title: string
    readonly message: string
    readonly app: Option.Option<{ readonly name: string; readonly icon: string | null }>
  },
) =>
  HttpServerResponse.html(
    fill(template, {
      status: input.ok ? "ok" : "error",
      app: Option.isSome(input.app) ? "some" : "none",
      logo: Option.match(input.app, {
        onNone: () => "",
        onSome: (app) =>
          app.icon
            ? `<img class="logo" src="${escape(app.icon)}" alt="" />`
            : `<div class="logo">${escape(app.name.slice(0, 1).toUpperCase())}</div>`,
      }),
      title: escape(input.title),
      message: escape(input.message),
    }),
  )

const again = "Go back to Ren and press Connect again."

const ended = /[.!?]$/u

const sentence = (reason: string) => reasons[reason] ?? (ended.test(reason) ? reason : `${reason}.`)

// oxlint-disable-next-line ren/no-comments -- owner-access §8 and §9 rule 3: the callback has no login check, because `state` is the authentication; a browser session must be the initiator's. The client metadata document lets a server that supports it take Ren's client without a registration (A33).
// oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect's HttpRouter.use, not a React hook
export const layer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const oauth = yield* OAuth.Service
    const auth = yield* Auth.Service
    const template = yield* Effect.promise(() => Bun.file(new URL("oauth-done.html", import.meta.url)).text())
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
        if (!state)
          return page(template, {
            ok: false,
            title: "Sign-in failed",
            message: `The address has no sign-in state. ${again}`,
            app: Option.none(),
          })
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
        const name = Option.match(outcome.app, { onNone: () => "The app", onSome: (app) => app.name })
        if (!outcome.ok)
          return page(template, {
            ok: false,
            title: Option.isSome(outcome.app) ? `${name} didn’t connect` : "Sign-in failed",
            message: `${sentence(outcome.reason)} ${again}`,
            app: outcome.app,
          })
        return page(template, {
          ok: true,
          title: `${name} is connected`,
          message: Option.match(outcome.sameAccountAs, {
            onNone: () =>
              `Ren can use ${name}${Option.match(outcome.space, { onNone: () => "", onSome: (space) => ` in ${space}` })} now. Go back to Ren to keep working.`,
            onSome: (account) => `This is the same account as ${account}.`,
          }),
          app: outcome.app,
        })
      }),
    )
  }),
)
