import { DurableObject } from "cloudflare:workers"
import { Effect, Exit, Schema, Scope } from "effect"
import { Brain } from "./brain.js"
import { Env } from "./env.js"
import { OpenCodeHarness } from "./harness/opencode/harness.js"
import { Lease } from "./lease.js"
import { Reconcile } from "./reconcile.js"

interface Activity {
  requests: number
  waiting: number | undefined
}

export class SessionCell extends DurableObject {
  readonly vars = Schema.decodeUnknownSync(Env.Vars)(this.env)
  readonly harness = Lease.make(
    OpenCodeHarness.open(this.ctx.storage, this.vars.OPENCODE_CONFIG),
    (harness) => harness.close,
  )
  readonly activity: Activity = { requests: 0, waiting: undefined }
  readonly brain = Brain.make(this.ctx.id.name, this.harness.acquire)

  override async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === "/cell" || url.pathname.startsWith("/cell/")) {
      if (request.method !== "GET" || url.pathname !== "/cell/state") return new Response(null, { status: 404 })
      return Response.json({
        harnessOpen: this.harness.state().open,
        leases: this.harness.state().leases,
        alarmAt: await this.ctx.storage.getAlarm(),
        waiting: this.activity.waiting ?? null,
      })
    }
    this.activity.requests += 1
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + this.vars.ALARM_INTERVAL_MS)
    if (url.pathname === "/ren" || url.pathname.startsWith("/ren/")) return this.brain(request)
    const scope = Scope.makeUnsafe()
    const release = () => Effect.runPromise(Scope.close(scope, Exit.void))
    const response = await Effect.runPromise(
      this.harness.acquire.pipe(
        Scope.provide(scope),
        Effect.flatMap((harness) => Effect.promise(() => harness.fetch(request))),
        Effect.onError(() => Scope.close(scope, Exit.void)),
      ),
    )
    const body = response.body
    if (!body) {
      await release()
      return response
    }
    const stream = new IdentityTransformStream()
    void body.pipeTo(stream.writable).then(release, release)
    return new Response(stream.readable, response)
  }

  override async alarm() {
    const storage = this.ctx.storage
    const vars = this.vars
    const activity = this.activity
    const lease = this.harness
    if (activity.waiting) return storage.setAlarm(Date.now() + vars.ALARM_INTERVAL_MS)
    const requests = activity.requests
    const idle = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const harness = yield* lease.acquire
          const labelled = (yield* harness.sessions).map((session) => ({
            session,
            work: Reconcile.work(session, vars.PARK_AFTER_MS),
          }))
          yield* Effect.forEach(
            labelled,
            (entry) => {
              if (entry.work._tag === "Unanswered") return entry.session.interrupt
              if (entry.work._tag === "Queued") return entry.session.resend(entry.work.item.id)
              return Effect.void
            },
            { discard: true },
          )
          const running = labelled.filter((entry) => entry.work._tag === "Running")
          if (running.length > 0) {
            yield* Effect.promise(() => storage.setAlarm(Date.now() + vars.ALARM_INTERVAL_MS))
            activity.waiting = Date.now()
            yield* Effect.forEach(
              running,
              (entry) =>
                entry.session.wait(
                  Math.min(vars.WAIT_BUDGET_MS, vars.PARK_AFTER_MS - (entry.session.askedMs ?? -Infinity)),
                ),
              { concurrency: "unbounded", discard: true },
            ).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  activity.waiting = undefined
                }),
              ),
            )
          }
          return labelled.every((entry) => entry.work._tag === "Idle")
        }),
      ),
    )
    if (!idle || lease.state().leases > 0 || activity.requests !== requests)
      return storage.setAlarm(Date.now() + vars.ALARM_INTERVAL_MS)
    await Effect.runPromise(lease.close)
  }
}
