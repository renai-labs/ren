export * as CodeUpdate from "./code-update.js"

import { BrainRejectedError } from "@ren/host-api/errors"
import type { Bundle } from "@ren/schema/bundle"
import { Context, Effect, Layer } from "effect"

export interface Bundled extends Bundle.Info {
  readonly token: string
}

// oxlint-disable-next-line ren/no-comments -- How a machine takes newer bundles of Ren's code at a wake (EN27). Only a machine that runs start.sh can; any other host is replaced instead.
export interface Interface {
  readonly update: (bundles: ReadonlyArray<Bundled>) => Effect.Effect<void, BrainRejectedError>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/CodeUpdate") {}

export const layerNone = Layer.succeed(
  Service,
  Service.of({
    update: () => Effect.fail(new BrainRejectedError({ message: "This host takes no bundles; Ren replaces it" })),
  }),
)
