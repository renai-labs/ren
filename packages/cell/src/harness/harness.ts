export * as Harness from "./harness.js"

import type { StartBody } from "@ren/host-api/brain-api"
import type { BrainRejectedError, SessionNotStartedError, SyncUnavailableError } from "@ren/host-api/errors"
import type { Models } from "@ren/schema/models"
import type { Session } from "@ren/schema/session"
import { Context, Effect, Exit, Layer, type Option, Scope } from "effect"
import { Lease } from "../lease.js"
import type { Reconcile } from "../reconcile.js"

interface SessionState extends Reconcile.Snapshot {
  readonly id: string
  readonly resend: (id: string) => Effect.Effect<void>
  readonly wait: (ms: number) => Effect.Effect<void>
  readonly interrupt: Effect.Effect<void>
}

export type Refresh = (endpointId: string) => Effect.Effect<Option.Option<Models.ApiKey>>

export interface Instance {
  readonly fetch: (request: Request) => Promise<Response>
  readonly configure: (endpoints: ReadonlyArray<Models.Endpoint>) => Effect.Effect<void>
  readonly start: (input: StartBody) => Effect.Effect<Session.Started, BrainRejectedError | SyncUnavailableError>
  readonly send: (
    input: Session.SendInput,
  ) => Effect.Effect<Session.Accepted, BrainRejectedError | SessionNotStartedError>
  readonly sessions: Effect.Effect<ReadonlyArray<SessionState>>
}

export interface Interface {
  readonly get: Effect.Effect<Instance, never, Scope.Scope>
  readonly state: Effect.Effect<{ readonly isOpen: boolean; readonly holders: number }>
  readonly close: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/Harness") {}

export const layer = (open: Effect.Effect<Instance, Error, Scope.Scope>) => {
  const lease = Lease.make(
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const instance = yield* open.pipe(
        Scope.provide(scope),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      )
      return { instance, scope }
    }),
    (opened) => Scope.close(opened.scope, Exit.void),
  )
  return Layer.succeed(
    Service,
    Service.of({
      get: lease.acquire.pipe(
        Effect.map((opened) => opened.instance),
        Effect.orDie,
      ),
      state: Effect.sync(() => ({ isOpen: lease.state().open, holders: lease.state().leases })),
      close: lease.close,
    }),
  )
}
