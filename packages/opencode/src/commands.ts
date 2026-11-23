export * as RenCommands from "./commands.js"

import type { Plugin } from "@opencode/plugin/tui"
import { Option, Schema } from "effect"
import { RenRpc } from "./rpc.js"

type Context = Plugin.Context

export interface Surface {
  readonly client: Pick<Context["client"], "rpc">
  readonly location: () => Context["location"]
  readonly ui: {
    readonly dialog: Pick<Context["ui"]["dialog"], "select">
    readonly toast: Context["ui"]["toast"]
    readonly router: Pick<Context["ui"]["router"], "navigate">
    readonly model: Pick<Context["ui"]["model"], "current">
  }
}

export interface SignInSurface extends Surface {
  readonly open: (url: string) => void
  readonly ui: Surface["ui"] & {
    readonly dialog: Pick<Context["ui"]["dialog"], "select" | "prompt" | "confirm" | "clear">
  }
}

const Failure = Schema.Struct({ type: Schema.optionalKey(Schema.String), message: Schema.String })

const at = (surface: Pick<Surface, "location">) => {
  const location = surface.location()
  return location && { location }
}

const fail = (surface: Surface) => (error: unknown) => {
  const failure = Schema.decodeUnknownOption(Failure)(error).pipe(
    Option.getOrElse(() => ({ type: undefined, message: "Ren did not answer." })),
  )
  const signedOut = failure.type === "signed_out"
  surface.ui.toast.show({
    title: signedOut ? "Sign in to Ren" : "Ren",
    message: failure.message,
    variant: signedOut ? "warning" : "error",
  })
}

export const space = (surface: Surface) => {
  const rpc = surface.client.rpc(RenRpc.Definition)
  return rpc
    .listSpaces({}, at(surface))
    .then(async (listed) => {
      const chosen = await surface.ui.dialog.select({
        title: "Ren space",
        placeholder: "Search spaces",
        options: listed.spaces.map((each) => ({ title: each.name, value: each.id, description: each.slug })),
        ...(listed.selected && { current: listed.selected }),
        search: (query, options) =>
          options.filter((option) => option.title.toLowerCase().includes(query.trim().toLowerCase())),
      })
      if (!chosen || chosen === listed.selected) return
      const selected = await rpc.selectSpace({ spaceId: chosen }, at(surface))
      surface.ui.toast.show({ message: `Ren space: ${selected.name}`, variant: "success" })
    })
    .catch(fail(surface))
}

export const create = (surface: Surface) => {
  const model = surface.ui.model.current()
  return surface.client
    .rpc(RenRpc.Definition)
    .createSession(
      model?.providerID === "ren"
        ? { model: { id: model.modelID, ...(model.variant && { variant: model.variant }) } }
        : {},
      at(surface),
    )
    .then((created) => surface.ui.router.navigate({ type: "session", sessionID: created.sessionID }))
    .catch(fail(surface))
}

export const selected = (surface: Pick<Surface, "client" | "location">) =>
  surface.client
    .rpc(RenRpc.Definition)
    .getSpace({}, at(surface))
    .then(
      (space): RenRpc.SpaceInfo | undefined => space,
      () => undefined,
    )

const fromEnvironment = (surface: Surface) =>
  surface.ui.toast.show({
    title: "Ren",
    message: "Ren uses REN_TOKEN from the environment. Unset it to sign in or out from OpenCode.",
    variant: "warning",
  })

type Outcome =
  | { readonly type: "signed_in"; readonly user: RenRpc.User }
  | { readonly type: "failed"; readonly message: string }

export const login = (surface: SignInSurface) => {
  const rpc = surface.client.rpc(RenRpc.Definition)
  const attempt = crypto.randomUUID()
  const outcome = Promise.withResolvers<Outcome>()
  const stops = [
    rpc.events.on("signedIn", (event) => {
      if (event.data.attempt === attempt) outcome.resolve({ type: "signed_in", user: event.data.user })
    }),
    rpc.events.on("loginFailed", (event) => {
      if (event.data.attempt === attempt) outcome.resolve({ type: "failed", message: event.data.message })
    }),
  ]
  const settled = outcome.promise.then((result) => {
    surface.ui.dialog.clear()
    return result
  })
  const wait = (url: string): Promise<Outcome | undefined> =>
    Promise.race([
      settled,
      surface.ui.dialog
        .prompt({
          title: "Sign in to Ren",
          description: `Sign in to Ren in your browser:\n${url}\n\nThis closes once you are signed in. If the browser cannot reach this machine, paste the address it was sent to.`,
          placeholder: "Redirect URL",
        })
        .then((answer) => ({ type: "answer" as const, answer })),
    ]).then((next) => {
      if (next.type !== "answer") return next
      if (!next.answer?.trim())
        return Promise.race([settled, rpc.cancelLogin({ attempt }, at(surface)).then(() => undefined)])
      return rpc.completeLogin({ attempt, url: next.answer }, at(surface)).then(
        () => settled,
        (error: unknown) => {
          fail(surface)(error)
          return wait(url)
        },
      )
    })
  return rpc
    .account({}, at(surface))
    .then(async (account) => {
      if (account.environment) return fromEnvironment(surface)
      if (
        account.user &&
        !(await surface.ui.dialog.confirm({
          title: "Ren",
          message: `Signed in to ${account.server} as ${account.user.name} (${account.user.email}). Sign in again?`,
        }))
      )
        return
      const started = await rpc.login({ attempt }, at(surface))
      surface.open(started.url)
      const result = await wait(started.url)
      if (result?.type === "signed_in")
        surface.ui.toast.show({
          message: `Signed in to Ren as ${result.user.name} (${result.user.email}).`,
          variant: "success",
        })
      if (result?.type === "failed")
        surface.ui.toast.show({ title: "Sign in to Ren", message: result.message, variant: "error" })
    })
    .catch(fail(surface))
    .finally(() => {
      for (const stop of stops) stop()
    })
}

export const logout = (surface: Surface) => {
  const rpc = surface.client.rpc(RenRpc.Definition)
  return rpc
    .account({}, at(surface))
    .then(async (account) => {
      if (account.environment) return fromEnvironment(surface)
      const result = await rpc.logout({}, at(surface))
      surface.ui.toast.show(
        result.signedOut
          ? { message: `Signed out of ${result.server}.`, variant: "success" }
          : { message: `Not signed in to ${result.server}.`, variant: "info" },
      )
    })
    .catch(fail(surface))
}
