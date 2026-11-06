export * as MachineAccess from "./machine-access.js"

import type { Effect } from "effect"

export type Access<Target> =
  | { readonly _tag: "Ready"; readonly target: Target }
  | { readonly _tag: "Starting"; readonly phase: string }
  | { readonly _tag: "Failed"; readonly reason: string }

// oxlint-disable-next-line ren/no-comments -- The one contract that Ren calls for a machine, whatever its family (EN1). `check` is for a caller whose call to the machine failed.
export interface Interface<Id extends string, Target> {
  readonly ensure: (id: Id) => Effect.Effect<void>
  readonly access: (id: Id) => Effect.Effect<Access<Target>>
  readonly check: (id: Id) => Effect.Effect<void>
  readonly retry: (id: Id) => Effect.Effect<void>
}
