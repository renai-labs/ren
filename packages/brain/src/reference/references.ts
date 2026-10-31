export * as References from "./references.js"

import type { Effect } from "effect"
import type { EnvironmentCopies } from "../environment/copies.js"

export interface Ready {
  readonly type: "ready"
  readonly alias: string
  readonly description: string
  readonly path: string
  readonly copy: EnvironmentCopies.Copy
}

export interface Unavailable {
  readonly type: "unavailable"
  readonly alias: string
  readonly note: string
}

export type Prepared = Ready | Unavailable

export const isReady = (prepared: Prepared): prepared is Ready => prepared.type === "ready"

export interface Source {
  readonly root: string
  readonly note: string
  readonly readOnly: string
  readonly prepared: () => ReadonlyArray<Prepared>
  readonly refresh: Effect.Effect<void>
  readonly ready: Effect.Effect<void>
}
