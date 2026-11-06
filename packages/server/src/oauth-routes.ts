export * as OAuthRoutes from "./oauth-routes.js"

import { OAuth } from "@ren/core/oauth"
import { Effect, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { Auth } from "./auth.js"

const escape = (text: string) => text.replaceAll(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`)

const check =
  "M9.99997 18C12.1217 18 14.1565 17.1571 15.6568 15.6569C17.1571 14.1566 18 12.1217 18 10C18 7.87827 17.1571 5.84343 15.6568 4.34314C14.1565 2.84285 12.1217 2 9.99997 2C7.87824 2 5.84341 2.84285 4.34312 4.34314C2.84282 5.84343 1.99997 7.87827 1.99997 10C1.99997 12.1217 2.84282 14.1566 4.34312 15.6569C5.84341 17.1571 7.87824 18 9.99997 18ZM13.857 8.191C13.9149 8.11129 13.9565 8.02095 13.9795 7.92514C14.0025 7.82933 14.0064 7.72993 13.991 7.63262C13.9756 7.5353 13.9412 7.44198 13.8897 7.35797C13.8382 7.27396 13.7707 7.20091 13.691 7.143C13.6113 7.08509 13.5209 7.04344 13.4251 7.02044C13.3293 6.99744 13.2299 6.99354 13.1326 7.00895C13.0353 7.02436 12.9419 7.0588 12.8579 7.11028C12.7739 7.16176 12.7009 7.22929 12.643 7.309L9.15997 12.099L7.27997 10.219C7.21075 10.1474 7.12796 10.0903 7.03644 10.051C6.94492 10.0118 6.8465 9.99113 6.74691 9.99032C6.64733 9.9895 6.54858 10.0085 6.45642 10.0463C6.36427 10.084 6.28056 10.1398 6.21017 10.2102C6.13979 10.2807 6.08414 10.3644 6.04647 10.4566C6.0088 10.5488 5.98987 10.6476 5.99078 10.7472C5.9917 10.8467 6.01243 10.9451 6.05178 11.0366C6.09113 11.1281 6.1483 11.2108 6.21997 11.28L8.71997 13.78C8.7966 13.8567 8.88893 13.9158 8.99061 13.9534C9.0923 13.9909 9.20091 14.006 9.30898 13.9975C9.41705 13.9891 9.522 13.9573 9.6166 13.9044C9.7112 13.8515 9.79321 13.7787 9.85697 13.691L13.857 8.191Z"

const alert =
  "M18 10C18 12.1217 17.1571 14.1566 15.6568 15.6569C14.1565 17.1571 12.1217 18 9.99997 18C7.87824 18 5.84341 17.1571 4.34312 15.6569C2.84282 14.1566 1.99997 12.1217 1.99997 10C1.99997 7.87827 2.84282 5.84343 4.34312 4.34314C5.84341 2.84285 7.87824 2 9.99997 2C12.1217 2 14.1565 2.84285 15.6568 4.34314C17.1571 5.84343 18 7.87827 18 10ZM9.99997 5C10.1989 5 10.3896 5.07902 10.5303 5.21967C10.671 5.36032 10.75 5.55109 10.75 5.75V10.25C10.75 10.4489 10.671 10.6397 10.5303 10.7803C10.3896 10.921 10.1989 11 9.99997 11C9.80106 11 9.61029 10.921 9.46964 10.7803C9.32899 10.6397 9.24997 10.4489 9.24997 10.25V5.75C9.24997 5.55109 9.32899 5.36032 9.46964 5.21967C9.61029 5.07902 9.80106 5 9.99997 5ZM9.99997 15C10.2652 15 10.5195 14.8946 10.7071 14.7071C10.8946 14.5196 11 14.2652 11 14C11 13.7348 10.8946 13.4804 10.7071 13.2929C10.5195 13.1054 10.2652 13 9.99997 13C9.73475 13 9.4804 13.1054 9.29286 13.2929C9.10533 13.4804 8.99997 13.7348 8.99997 14C8.99997 14.2652 9.10533 14.5196 9.29286 14.7071C9.4804 14.8946 9.73475 15 9.99997 15Z"

const sheet = `*{box-sizing:border-box;margin:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;background:#151515;color:#f1f1f1;font-family:"SF Pro Variable",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:400px;display:flex;flex-direction:column;align-items:center;gap:16px;padding:32px;background:#1f1f1f;border:1px solid rgba(255,255,255,.08);border-radius:12px;text-align:center}
.mark{position:relative;width:56px;height:56px}
.logo{width:48px;height:48px;border-radius:8px;object-fit:cover;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);font-size:20px;font-weight:510}
.badge{position:absolute;left:32px;top:32px;width:24px;height:24px;border-radius:9999px;background:#1f1f1f;display:flex;align-items:center;justify-content:center}
.heading{display:flex;flex-direction:column;gap:6px;overflow-wrap:anywhere}
h1{font-size:20px;line-height:28px;font-weight:510}
p{font-size:14px;line-height:20px;color:#a3a3a3}
small{font-size:12px;line-height:16px;color:#a3a3a3}
button{height:32px;padding:0 12px;border:1px solid rgba(255,255,255,.08);border-radius:8px;background:transparent;color:#a3a3a3;font:inherit;font-size:14px;font-weight:510;cursor:pointer}
button:hover{background:rgba(255,255,255,.04);color:#f1f1f1}
button:focus-visible{outline:3px solid rgba(163,163,163,.5)}`

const reasons: Readonly<Record<string, string>> = {
  "StateInvalid: expired": "The sign-in expired.",
  "StateInvalid: used": "This sign-in was already used.",
  "StateInvalid: unknown": "Ren does not know this sign-in.",
  "StateInvalid: other_user": "You are signed in to Ren as another person.",
}

const page = (input: {
  readonly ok: boolean
  readonly title: string
  readonly message: string
  readonly app: Option.Option<{ readonly name: string; readonly icon: string | null }>
}) => {
  const logo = Option.match(input.app, {
    onNone: () => "",
    onSome: (app) =>
      `<div class="mark">${
        app.icon
          ? `<img class="logo" src="${escape(app.icon)}" alt="">`
          : `<div class="logo">${escape(app.name.slice(0, 1).toUpperCase())}</div>`
      }<span class="badge"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" fill="${input.ok ? "#53c878" : "#f47780"}" d="${input.ok ? check : alert}"/></svg></span></div>`,
  })
  const footer = input.ok
    ? `<small id="footer">This tab closes in 2 s.</small><script>setTimeout(() => { window.close(); document.getElementById("footer").textContent = "You can close this tab." }, 2000)</script>`
    : `<button type="button" onclick="window.close()">Close tab</button>`
  return HttpServerResponse.html(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.title)}</title><style>${sheet}</style></head><body><main>${logo}<div class="heading"><h1>${escape(input.title)}</h1><p>${escape(input.message)}</p></div>${footer}</main></body></html>`,
  )
}

const again = "Go back to Ren and press Connect again."

const ended = /[.!?]$/u

const sentence = (reason: string) => reasons[reason] ?? (ended.test(reason) ? reason : `${reason}.`)

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
        if (!state)
          return page({
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
          return page({
            ok: false,
            title: Option.isSome(outcome.app) ? `${name} didn’t connect` : "Sign-in failed",
            message: `${sentence(outcome.reason)} ${again}`,
            app: outcome.app,
          })
        return page({
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
