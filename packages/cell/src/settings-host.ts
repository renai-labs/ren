export * as SettingsHost from "./settings-host.js"

import { BrainSettings } from "@ren/brain/settings"
import { Context, Effect, Layer, Option } from "effect"
import { Cell } from "./cell.js"
import { HostToken } from "./host-token.js"

export class Service extends Context.Service<Service, Pick<BrainSettings.Host, "read">>()("@ren/cell/SettingsHost") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const info = yield* Cell.Info
    const hostToken = yield* HostToken.Service
    if (!info.vars.REN_URL) return yield* Effect.die(new Error("SettingsHost needs REN_URL"))
    const host = yield* HostToken.client(info.vars.REN_URL)
    return Service.of({
      read: (known) =>
        Effect.gen(function* () {
          const token = yield* hostToken.current
          if (Option.isNone(token))
            return yield* new BrainSettings.PullError({ message: "The cell has no valid host token" })
          return yield* host.settings["settings.read"]({ payload: known }).pipe(
            HostToken.withToken(token.value),
            Effect.timeout(HostToken.renAnswersWithin),
            Effect.mapError(
              (error) => new BrainSettings.PullError({ message: `Ren did not send the settings: ${error.message}` }),
            ),
          )
        }),
    })
  }),
)
