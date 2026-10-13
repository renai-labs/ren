export * as Harness from "./harness.js"

import type { BrainRejectedError, SessionNotStartedError } from "@ren/brain-api/errors"
import type { Session } from "@ren/schema/session"
import type { Effect } from "effect"
import type { Reconcile } from "../reconcile.js"

interface SessionState extends Reconcile.Session {
  readonly id: string
  readonly resend: (id: string) => Effect.Effect<void>
  readonly wait: (ms: number) => Effect.Effect<void>
  readonly interrupt: Effect.Effect<void>
}

export interface Instance {
  readonly fetch: (request: Request) => Promise<Response>
  readonly close: Effect.Effect<void>
  readonly start: (input: Session.StartInput) => Effect.Effect<Session.Started, BrainRejectedError>
  readonly send: (
    input: Session.SendInput,
  ) => Effect.Effect<Session.Accepted, BrainRejectedError | SessionNotStartedError>
  readonly sessions: Effect.Effect<ReadonlyArray<SessionState>>
}
