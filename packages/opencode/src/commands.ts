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
