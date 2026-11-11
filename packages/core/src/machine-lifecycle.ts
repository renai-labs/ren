export * as MachineLifecycle from "./machine-lifecycle.js"

import type { Auth } from "@ren/schema/auth"
import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Machine } from "@ren/schema/machine"
import type { Space } from "@ren/schema/space"
import { Cause, Clock, DateTime, Duration, Effect, ErrorReporter, Option, Schedule, Schema } from "effect"
import type { MachineAccess } from "./machine-access.js"
import { MachineProvider } from "./machine-provider.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("MachineLifecycle.Unavailable", {
  message: Schema.String,
}) {}

export class Starting extends Schema.TaggedError<Starting>()("MachineLifecycle.Starting", {
  message: Schema.String,
}) {}

export class Unreachable extends Schema.TaggedError<Unreachable>()("MachineLifecycle.Unreachable", {
  message: Schema.String,
}) {}

export class Failed extends Schema.TaggedError<Failed>()("MachineLifecycle.Failed", { message: Schema.String }) {}

export class Replaced extends Schema.TaggedError<Replaced>()("MachineLifecycle.Replaced", { message: Schema.String }) {}

export class Frozen extends Schema.TaggedError<Frozen>()("MachineLifecycle.Frozen", {
  message: Schema.String,
  reason: Schema.Literals(["memory", "disk", "unknown"]),
}) {}

export const timing = {
  boot: Duration.seconds(120),
  wake: Duration.seconds(60),
  idle: Duration.minutes(10),
  busy: Duration.minutes(30),
  stuck: Duration.minutes(30),
  // oxlint-disable-next-line ren/no-comments -- EN25: a background process keeps a machine awake until this long after its last turn's progress.
  background: Duration.hours(2),
  poll: Duration.seconds(1),
  probeTimeout: Duration.seconds(3),
  sampleMaxAge: Duration.seconds(60),
  fullShare: 0.95,
  failures: 3,
  // oxlint-disable-next-line ren/no-comments -- EN19: the waits before a failed machine starts again at its next access: 10 min, 30 min, then every hour.
  retries: [Duration.minutes(10), Duration.minutes(30), Duration.hours(1)],
  // oxlint-disable-next-line ren/no-comments -- EN17: a machine that runs but whose brain gives no answer for this long is replaced. A check later than `silentCount` after the first one starts the count again, because the brain may have answered in between.
  silent: Duration.minutes(5),
  silentCount: Duration.minutes(10),
}

// oxlint-disable-next-line ren/no-comments -- The columns of a managed machine's row. Each kind of machine keeps them in its own table under these names.
export interface Row<Id extends string> {
  readonly id: Id
  readonly organization_id: Auth.OrganizationID
  readonly space_id: Space.ID
  readonly provider: string | null
  readonly binding: Schema.Json | null
  // oxlint-disable-next-line ren/no-comments -- The image the machine runs, and the template config it was built from when it is a template's image.
  readonly image: string | null
  readonly image_template: TemplateConfig | null
  readonly egress: boolean
  readonly url: string | null
  readonly generation: number
  readonly run_epoch: number
  readonly phase: Machine.Phase
  readonly failures: number
  readonly failure: string | null
  readonly keep_alive_until: Date | null
  readonly last_active_at: Date | null
  readonly last_progress_at: Date | null
  readonly retry_at: Date | null
  readonly retries: number
  readonly unanswered_since: Date | null
  // oxlint-disable-next-line ren/no-comments -- The host list the provider last got for the machine; null for any host.
  readonly network_hosts: ReadonlyArray<string> | null
}

export interface TemplateConfig {
  readonly environmentTemplateId: EnvironmentTemplate.ID
  readonly config: Schema.Json
  // oxlint-disable-next-line ren/no-comments -- The system image the template's image was built on, without its dependencies (MachineProvider.systemOf). Only a new machine changes it.
  readonly system: string | null
}

// oxlint-disable-next-line ren/no-comments -- What the owner wants for its machine now: the provider config of a new machine, a template's image (none: the provider's own), and the hosts it may reach (none: any).
export interface DesiredSetup {
  readonly config: Schema.Json
  readonly image: Option.Option<{ readonly name: string; readonly template: TemplateConfig }>
  readonly hosts: Option.Option<ReadonlyArray<string>>
}

export interface Definition<Id extends string, R extends Row<Id>, Target, E> {
  // oxlint-disable-next-line ren/no-comments -- Names the kind in spans (`BrainLifecycle.step`), in messages (`Brain brn_…`) and in log annotations (`ren.brain.id`).
  readonly name: string
  readonly noun: string
  readonly annotation: string
  readonly kind: MachineProvider.Labels["kind"]
  // oxlint-disable-next-line ren/no-comments -- The provider of the row's machine: the one that made it, or for a new machine the one its owner chose.
  readonly providerOf: (row: R) => Effect.Effect<MachineProvider.Provider>
  readonly isBehindEgress: (provider: MachineProvider.Provider) => boolean
  readonly bootWithin: Duration.Duration
  readonly wakeWithin: Duration.Duration
  readonly read: (id: Id) => Effect.Effect<R>
  // oxlint-disable-next-line ren/no-comments -- With `only`, the write happens only while the row still has that phase and generation, so a write after a wait cannot undo a change made during it.
  readonly update: (
    id: Id,
    values: Partial<Row<Id>>,
    only?: Pick<Row<Id>, "phase" | "generation">,
  ) => Effect.Effect<void>
  // oxlint-disable-next-line ren/no-comments -- In one transaction: the next generation, no binding, url or keep-alive, `creating`, and the kind's own work, such as interrupting busy chats.
  readonly replace: (row: R, at: Date) => Effect.Effect<void>
  // oxlint-disable-next-line ren/no-comments -- Marks the machine of this generation `replacing`, unless it is already creating or replacing, and does the kind's own work in the same transaction. True when it marked it.
  readonly forceReplace: (id: Id, generation: number, at: Date) => Effect.Effect<boolean>
  // oxlint-disable-next-line ren/no-comments -- Whether work waits for the machine after a forced replace, such as a chat to continue (EN35). Then the replace starts at once.
  readonly isNeeded: (id: Id) => Effect.Effect<boolean>
  // oxlint-disable-next-line ren/no-comments -- Starts the kind's durable run for the row's run epoch, which calls `run`.
  readonly ensure: (row: R) => Effect.Effect<void>
  readonly proxyFor: (row: R) => Effect.Effect<Option.Option<MachineProvider.Proxy>>
  readonly retire: (id: Id) => Effect.Effect<void>
  // oxlint-disable-next-line ren/no-comments -- What a new machine starts with, and the write of the kind's own columns that records it. Both come from one read, so the row says what the machine got.
  readonly startup: (row: R) => Effect.Effect<{
    readonly variables: Readonly<Record<string, string>>
    readonly created: Effect.Effect<void>
  }>
  readonly desiredSetup: (row: R) => Effect.Effect<DesiredSetup>
  // oxlint-disable-next-line ren/no-comments -- The hosts of the template the running machine applied, which keep to that template's live host list while a newer one waits for the next wake. None: any host.
  readonly appliedHosts: (row: R) => Effect.Effect<Option.Option<ReadonlyArray<string>>>
  // oxlint-disable-next-line ren/no-comments -- Applies the owner's settings to a woken machine before its wake call. False when the machine cannot run them, so it is replaced instead.
  readonly publish?: (row: R) => Effect.Effect<boolean>
  readonly target: (row: R) => Option.Option<Target>
  // oxlint-disable-next-line ren/no-comments -- The kind's ready check: none when the machine is ready within the time, or the reason it is not.
  readonly boot: (target: Target, within: Duration.Duration) => Effect.Effect<Option.Option<string>, E>
  // oxlint-disable-next-line ren/no-comments -- The kind's wake call after a resume. It ends within the time with true, or with whether the machine still answers.
  readonly wake: (target: Target, within: Duration.Duration) => Effect.Effect<boolean, E>
  readonly answers: (target: Target) => Effect.Effect<boolean>
  // oxlint-disable-next-line ren/no-comments -- Whether the machine's code is current when it wakes: `update` in place, or `replace` when it cannot be updated in place (EN22, EN27).
  readonly changeAtWake: (row: R) => Effect.Effect<"current" | "update" | "replace">
  // oxlint-disable-next-line ren/no-comments -- The in-place update of a woken machine: Ren's code when it is out of date, then the steps to its template's new config. None when it worked, or the reason it did not. A kind without it is replaced for any change.
  readonly updateInPlace?: (
    row: R,
    target: Target,
    steps: ReadonlyArray<MachineProvider.Step>,
  ) => Effect.Effect<Option.Option<string>, E>
}

const reasonOf = (sample: MachineProvider.Sample | undefined) => {
  if (sample && sample.memory >= timing.fullShare) return "memory" as const
  if (sample && sample.disk >= timing.fullShare) return "disk" as const
  return "unknown" as const
}

const startKinds: Readonly<Partial<Record<Machine.Phase, string>>> = {
  creating: "new",
  booting: "new",
  replacing: "replace",
}

// oxlint-disable-next-line ren/no-comments -- What a woken machine does next: wake as it is, update in place, or, for a change that its kind cannot make in place, be replaced (EN22, EN27).
const phaseAfterResume = (
  code: "current" | "update" | "replace",
  options: { readonly hasSteps: boolean; readonly canUpdateInPlace: boolean },
) => {
  if (code === "replace") return "replacing" as const
  if (code === "current" && !options.hasSteps) return "waking" as const
  return options.canUpdateInPlace ? ("updating" as const) : ("replacing" as const)
}

const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis))

const desiredImage = (desired: DesiredSetup, provider: MachineProvider.Provider) =>
  Option.match(desired.image, { onNone: () => provider.systemImage, onSome: (image) => image.name })

// oxlint-disable-next-line ren/no-comments -- EN22: the steps that bring a machine to the image its owner wants, in place: none needed, the steps between two configs of its template on one system image, or none possible (a replace; templates rules 1, 3).
const stepsInPlace = <Id extends string>(row: Row<Id>, desired: DesiredSetup, provider: MachineProvider.Provider) => {
  const image = desiredImage(desired, provider)
  if (!image || !row.image || MachineProvider.systemOf(row.image) === MachineProvider.systemOf(image))
    return Option.some<ReadonlyArray<MachineProvider.Step>>([])
  const from = row.image_template
  return Option.flatMap(
    Option.filter(
      desired.image,
      (found) =>
        from?.environmentTemplateId === found.template.environmentTemplateId && from.system === found.template.system,
    ),
    (found) => (from ? provider.stepsBetween(from.config, found.template.config) : Option.none()),
  )
}

export const make = <Id extends string, R extends Row<Id>, Target, E>(definition: Definition<Id, R, Target, E>) => {
  const name = definition.name
  const noun = definition.noun
  const read = definition.read
  const update = definition.update
  const annotate = (row: Pick<R, "id" | "generation">) =>
    Effect.annotateLogs({
      [`ren.${definition.annotation}.id`]: row.id,
      [`ren.${definition.annotation}.generation`]: row.generation,
    })

  const keepAlive = Effect.fnUntraced(function* (row: R, window: Duration.Duration) {
    if (!row.binding) return
    const at = yield* now
    const left = row.keep_alive_until ? row.keep_alive_until.getTime() - at.getTime() : 0
    if (left > Duration.toMillis(window) / 2) return
    const provider = yield* definition.providerOf(row)
    yield* provider.keepAlive(row.binding, window)
    yield* update(row.id, { keep_alive_until: new Date(at.getTime() + Duration.toMillis(window)) })
  })

  // oxlint-disable-next-line ren/no-comments -- EN38: Ren sends an error report when a machine fails, waits for capacity, or is replaced by force.
  const report = (row: Pick<R, "id" | "generation">, error: Failed | Replaced | MachineProvider.Capacity) =>
    ErrorReporter.report(Cause.fail(error)).pipe(annotate(row))

  // oxlint-disable-next-line ren/no-comments -- The keep-alive from what runs on the machine: a turn with progress in the last 30 min keeps it 30 min more; a background process keeps it until 2 h after the last turn's progress (EN25).
  const keepAwake = Effect.fnUntraced(function* (
    row: R,
    activity: { readonly isBusy: boolean; readonly hasBackground: boolean },
  ) {
    if (!row.last_progress_at) return
    const at = (yield* now).getTime()
    const last = row.last_progress_at.getTime()
    const turnMs = activity.isBusy && at - last < Duration.toMillis(timing.stuck) ? Duration.toMillis(timing.busy) : 0
    const backgroundMs = activity.hasBackground
      ? Math.min(Duration.toMillis(timing.busy), last + Duration.toMillis(timing.background) - at)
      : 0
    const windowMs = Math.max(turnMs, backgroundMs)
    if (windowMs <= 0) return
    yield* keepAlive(row, Duration.millis(windowMs)).pipe(
      Effect.catch((error) => Effect.logWarning("keepAlive failed", error)),
    )
  })

  const fail = Effect.fnUntraced(function* (row: R, reason: string, next: Machine.Phase) {
    const failures = row.failures + 1
    yield* Effect.logWarning(`${noun} ${row.id} failed (${failures}/${timing.failures}): ${reason}`)
    if (failures < timing.failures) return yield* update(row.id, { failures, failure: reason, phase: next })
    const wait = timing.retries[Math.min(row.retries, timing.retries.length - 1)] ?? Duration.hours(1)
    yield* update(row.id, {
      failures,
      failure: reason,
      phase: "failed",
      retry_at: new Date((yield* now).getTime() + Duration.toMillis(wait)),
    })
    yield* report(row, new Failed({ message: `${noun} ${row.id} failed: ${reason}` }))
  })

  const ready = (row: R) =>
    update(row.id, { phase: "ready", failures: 0, failure: null, retries: 0, retry_at: null, unanswered_since: null })

  // oxlint-disable-next-line ren/no-comments -- Capacity is not a failure (E88): the machine shows "waiting for capacity", and the step that hit it runs again after Retry-After.
  const waitForCapacity = Effect.fnUntraced(function* (row: R, error: MachineProvider.Capacity) {
    yield* Effect.logWarning(`Waiting for capacity: ${error.message}`)
    yield* report(row, error)
    yield* update(row.id, { phase: "capacity" }, { phase: row.phase, generation: row.generation })
    yield* Effect.sleep(error.retryAfter)
    yield* update(row.id, { phase: row.phase }, { phase: "capacity", generation: row.generation })
  })

  const proxyOf = (row: R, provider: MachineProvider.Provider) =>
    definition.isBehindEgress(provider)
      ? definition.proxyFor(row)
      : Effect.succeed(Option.none<MachineProvider.Proxy>())

  const create = Effect.fnUntraced(function* (row: R) {
    const provider = yield* definition.providerOf(row)
    const proxy = yield* proxyOf(row, provider)
    const desired = yield* definition.desiredSetup(row)
    const startup = yield* definition.startup(row)
    const created = yield* provider
      .create({
        labels: {
          kind: definition.kind,
          id: row.id,
          generation: row.generation,
          organizationId: row.organization_id,
          spaceId: row.space_id,
        },
        config: desired.config,
        image: Option.map(desired.image, (image) => image.name),
        // oxlint-disable-next-line ren/no-comments -- Behind an egress, the machine calls Ren at REN_URL with the placeholder ren:REN; the egress puts in the host token (C8, C49).
        variables: { ...startup.variables, ...(Option.isSome(proxy) && { REN_EGRESS: "1" }) },
        network: { proxy, hosts: desired.hosts },
      })
      .pipe(
        Effect.map(Option.some),
        Effect.catchTag("MachineProvider.Capacity", (error) =>
          waitForCapacity(row, error).pipe(Effect.as(Option.none<MachineProvider.Created>())),
        ),
      )
    if (Option.isNone(created)) return false
    // oxlint-disable-next-line ren/no-comments -- The kind's own columns go before the machine's, so a crash between the two leaves a row that creates again.
    yield* startup.created
    yield* update(row.id, {
      provider: provider.info.id,
      binding: created.value.binding,
      image: desiredImage(desired, provider),
      image_template: Option.match(desired.image, { onNone: () => null, onSome: (image) => image.template }),
      egress: Option.isSome(proxy),
      network_hosts: Option.getOrNull(desired.hosts),
      url: created.value.url,
      phase: "booting",
      keep_alive_until: new Date((yield* now).getTime() + Duration.toMillis(timing.idle)),
    })
    return false
  })

  const boot = Effect.fnUntraced(function* (row: R) {
    const target = Option.getOrUndefined(definition.target(row))
    if (!target) return yield* update(row.id, { phase: "creating" }).pipe(Effect.as(false))
    const failure = yield* definition.boot(target, definition.bootWithin)
    if (Option.isSome(failure)) {
      const provider = yield* definition.providerOf(row)
      if (row.binding) yield* provider.destroy(row.binding).pipe(Effect.ignore)
      yield* fail(row, failure.value, "creating")
      yield* update(row.id, { binding: null, url: null })
      return false
    }
    yield* ready(row)
    yield* keepAlive(yield* read(row.id), timing.idle)
    return true
  })

  const resume = Effect.fnUntraced(function* (row: R) {
    if (!row.binding) return yield* update(row.id, { phase: "creating" }).pipe(Effect.as(false))
    const provider = yield* definition.providerOf(row)
    // oxlint-disable-next-line ren/no-comments -- An asleep machine on another image moves to the desired one at its wake: in place when its template's steps can, or by a replace (E120, EN21). Only this step checks, so a running machine is never changed for its image.
    const desired = yield* definition.desiredSetup(row)
    const steps = stepsInPlace(row, desired, provider)
    if (Option.isNone(steps)) {
      yield* Effect.logInfo(
        `${noun} ${row.id} runs image ${row.image}; Ren replaces it with ${desiredImage(desired, provider)}`,
      )
      return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
    }
    // oxlint-disable-next-line ren/no-comments -- A machine built for the other egress mode would get the wrong keys; it moves to the current one by a replace, as for a build (E120).
    if (row.egress !== definition.isBehindEgress(provider)) {
      yield* Effect.logInfo(
        `${noun} ${row.id} was created ${row.egress ? "behind" : "without"} the egress; Ren replaces it`,
      )
      return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
    }
    const connected = yield* provider
      .connect(row.binding, { proxy: yield* proxyOf(row, provider), hosts: desired.hosts })
      .pipe(
        Effect.map((found) => ({ _tag: "Connected", url: found.url }) as const),
        Effect.catchTag("MachineProvider.Gone", () => Effect.succeed({ _tag: "Gone" } as const)),
        Effect.catchTag("MachineProvider.Capacity", (error) =>
          waitForCapacity(row, error).pipe(Effect.as({ _tag: "Waited" } as const)),
        ),
      )
    if (connected._tag === "Waited") return false
    if (connected._tag === "Gone") {
      yield* report(row, new Replaced({ message: `${noun} ${row.id} is gone at its wake` }))
      return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
    }
    yield* update(row.id, {
      url: connected.url,
      keep_alive_until: null,
      network_hosts: Option.getOrNull(desired.hosts),
    })
    yield* keepAlive({ ...row, keep_alive_until: null }, timing.idle)
    const code = yield* definition.changeAtWake(row)
    const phase = phaseAfterResume(code, {
      hasSteps: steps.value.length > 0,
      canUpdateInPlace: Boolean(definition.updateInPlace),
    })
    if (phase === "replacing")
      yield* Effect.logInfo(`${noun} ${row.id} runs code or an image that cannot update in place; Ren replaces it`)
    yield* update(row.id, { phase })
    return false
  })

  // oxlint-disable-next-line ren/no-comments -- EN27: three failed updates replace the machine; its failures count from zero again on the new one.
  const updating = Effect.fnUntraced(function* (row: R) {
    const target = Option.getOrUndefined(definition.target(row))
    const provider = yield* definition.providerOf(row)
    const desired = yield* definition.desiredSetup(row)
    const steps = stepsInPlace(row, desired, provider)
    if (!target || Option.isNone(steps) || !definition.updateInPlace)
      return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
    const failure = yield* definition.updateInPlace(row, target, steps.value)
    if (Option.isNone(failure))
      return yield* update(row.id, {
        phase: "waking",
        failures: 0,
        failure: null,
        image: desiredImage(desired, provider),
        image_template: Option.match(desired.image, {
          onNone: () => row.image_template,
          onSome: (image) => image.template,
        }),
      }).pipe(Effect.as(false))
    const failures = row.failures + 1
    yield* Effect.logWarning(`${noun} ${row.id} did not update (${failures}/${timing.failures}): ${failure.value}`)
    yield* update(
      row.id,
      failures >= timing.failures
        ? { phase: "replacing", failures: 0, failure: failure.value }
        : { phase: "updating", failures, failure: failure.value },
    )
    return false
  })

  const wake = Effect.fnUntraced(function* (row: R) {
    const target = Option.getOrUndefined(definition.target(row))
    if (definition.publish && !(yield* definition.publish(row))) {
      yield* Effect.logInfo(`${noun} ${row.id} cannot run its owner's new settings; Ren replaces it`)
      return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
    }
    if (!target || !(yield* definition.wake(target, definition.wakeWithin)))
      return yield* update(row.id, { phase: "replacing" }).pipe(Effect.as(false))
    yield* ready(row)
    return true
  })

  const replace = Effect.fnUntraced(function* (row: R) {
    yield* definition.replace(row, yield* now)
    yield* definition.retire(row.id)
    const provider = yield* definition.providerOf(row)
    if (row.binding)
      yield* provider
        .destroy(row.binding)
        .pipe(Effect.catch((error) => Effect.logWarning("Destroying the replaced sandbox failed", error)))
    return false
  })

  const forceReplace = Effect.fnUntraced(function* (row: Pick<R, "id" | "generation">, reason: string) {
    if (!(yield* definition.forceReplace(row.id, row.generation, yield* now))) return
    yield* report(row, new Replaced({ message: `${noun} ${row.id}: ${reason}` }))
    // oxlint-disable-next-line ren/no-comments -- A forced replace starts at once when work waits, so the chats it interrupted continue without anyone asking (EN35).
    if (yield* definition.isNeeded(row.id)) yield* ensure(row.id)
  })

  // oxlint-disable-next-line ren/no-comments -- A machine that runs but does not answer is logged at the first check that finds it silent only; the checks until isSilent replaces it log nothing.
  const replaceIfFrozen = Effect.fnUntraced(function* (
    row: R,
    binding: Schema.Json,
    provider: MachineProvider.Provider,
  ) {
    const isFirst = !row.unanswered_since
    if (!provider.canSample) {
      if (!isFirst) return
      const message = `${noun} ${row.id} does not answer, and its provider reports no samples of its machine; Ren keeps it`
      return yield* Effect.logError(message, Cause.fail(new Unreachable({ message }))).pipe(annotate(row))
    }
    const found = yield* provider.lastSample(binding).pipe(
      Effect.tapError((error) => Effect.logWarning("The sandbox samples are unknown", error)),
      Effect.option,
    )
    if (Option.isNone(found)) return
    const sample = Option.getOrUndefined(found.value)
    const logged = (effect: Effect.Effect<void>) =>
      effect.pipe(
        annotate(row),
        Effect.annotateLogs(
          sample
            ? {
                "ren.sandbox.sampled_at": DateTime.formatIso(sample.at),
                "ren.sandbox.memory": sample.memory,
                "ren.sandbox.disk": sample.disk,
              }
            : {},
        ),
      )
    if (sample && Duration.isLessThan(DateTime.distance(sample.at, yield* DateTime.now), timing.sampleMaxAge)) {
      if (!isFirst) return
      const message = `${noun} ${row.id} does not answer, but its machine runs; Ren keeps it`
      return yield* logged(Effect.logError(message, Cause.fail(new Unreachable({ message }))))
    }
    const message = sample
      ? `${noun} ${row.id} does not answer, and its machine stopped at ${DateTime.formatIso(sample.at)} with ${Math.round(sample.memory * 100)}% of its memory and ${Math.round(sample.disk * 100)}% of its disk in use; Ren replaces it`
      : `${noun} ${row.id} does not answer, and its machine reports no samples; Ren replaces it`
    const reason = reasonOf(sample)
    yield* logged(Effect.logError(message, Cause.fail(new Frozen({ message, reason }))))
    yield* forceReplace(
      row,
      reason === "unknown" ? "its machine stopped" : `its machine stopped with its ${reason} full`,
    )
  })

  // oxlint-disable-next-line ren/no-comments -- Counts how long a running machine's brain has given no answer, from the first check that found it silent (EN17).
  const isSilent = Effect.fnUntraced(function* (row: R) {
    const at = yield* now
    const since =
      row.unanswered_since && at.getTime() - row.unanswered_since.getTime() < Duration.toMillis(timing.silentCount)
        ? row.unanswered_since
        : at
    if (since !== row.unanswered_since) yield* update(row.id, { unanswered_since: since })
    return at.getTime() - since.getTime() >= Duration.toMillis(timing.silent)
  })

  const check = Effect.fn(`${name}.check`)(function* (id: Id) {
    const row = yield* read(id)
    if (!row.binding) return
    const target = Option.filter(definition.target(row), () => row.phase === "ready")
    if (Option.isSome(target) && (yield* definition.answers(target.value))) {
      if (row.unanswered_since) yield* update(row.id, { unanswered_since: null })
      return
    }
    const provider = yield* definition.providerOf(row)
    const status = yield* provider.status(row.binding).pipe(
      Effect.tapError((error) => Effect.logWarning("The sandbox status is unknown", error)),
      Effect.option,
    )
    if (Option.isNone(status)) return
    if (status.value === "gone") return yield* forceReplace(row, "its machine is gone")
    if (row.phase !== "ready") return
    // oxlint-disable-next-line ren/no-comments -- A paused machine wakes; it is never replaced here (E123).
    if (status.value === "paused") return yield* update(row.id, { phase: "resuming" })
    if (yield* isSilent(row)) return yield* forceReplace(row, `it gave no answer for ${Duration.format(timing.silent)}`)
    yield* replaceIfFrozen(row, row.binding, provider)
  })

  // oxlint-disable-next-line ren/no-comments -- Ends a machine that nothing uses: destroys it and leaves the row at the next generation, `creating`.
  const rest = Effect.fnUntraced(function* (row: R) {
    if (!row.binding) return
    yield* definition.retire(row.id)
    const provider = yield* definition.providerOf(row)
    yield* provider.destroy(row.binding)
    yield* update(row.id, {
      generation: row.generation + 1,
      binding: null,
      url: null,
      keep_alive_until: null,
      phase: "creating",
    })
  })

  const settle = Effect.fnUntraced(function* (row: R) {
    const at = yield* now
    if (row.keep_alive_until && row.keep_alive_until.getTime() > at.getTime()) return true
    return yield* update(row.id, { phase: row.binding ? "resuming" : "creating" }).pipe(Effect.as(false))
  })

  const phases = {
    creating: create,
    booting: boot,
    resuming: resume,
    updating,
    waking: wake,
    replacing: replace,
    ready: settle,
    failed: () => Effect.succeed(true),
    capacity: (row) => update(row.id, { phase: row.binding ? "resuming" : "creating" }).pipe(Effect.as(false)),
  } satisfies Record<Machine.Phase, (row: R) => Effect.Effect<boolean, unknown>>

  const step = Effect.fn(`${name}.step`)(function* (id: Id) {
    const row = yield* read(id)
    return yield* phases[row.phase](row)
  })

  // oxlint-disable-next-line ren/no-comments -- The body of the kind's durable run: steps until the machine is ready or failed.
  const run = (id: Id) =>
    Effect.gen(function* () {
      const first = yield* read(id)
      let worked = false
      while (!(yield* step(id))) {
        worked = true
        yield* Effect.yieldNow
      }
      if (worked)
        yield* Effect.annotateCurrentSpan(
          `ren.${definition.annotation}.start_kind`,
          startKinds[first.phase] ?? (first.binding ? "resume" : "new"),
        )
    }).pipe(
      // oxlint-disable-next-line ren/no-comments -- EN18: every provider failure counts, so an outage ends in failed and its report, not in endless retries.
      Effect.catchIf(Schema.is(MachineProvider.Failed), (error) =>
        read(id).pipe(
          Effect.flatMap((row) => fail(row, error.message, row.phase)),
          Effect.andThen(Effect.fail(error)),
        ),
      ),
    )

  const ensure = (id: Id) => Effect.flatMap(read(id), definition.ensure)

  // oxlint-disable-next-line ren/no-comments -- Starts a failed machine's steps again under a new run epoch, with no failures.
  const restart = (row: R, retries: number) =>
    update(row.id, {
      phase: row.binding ? "resuming" : "creating",
      failures: 0,
      run_epoch: row.run_epoch + 1,
      retries,
      retry_at: null,
    })

  const access = Effect.fn(`${name}.access`)(function* (id: Id): Effect.fn.Return<MachineAccess.Access<Target>> {
    const row = yield* read(id)
    const at = yield* now
    const target = definition.target(row)
    if (
      row.phase === "ready" &&
      Option.isSome(target) &&
      row.keep_alive_until &&
      row.keep_alive_until.getTime() > at.getTime()
    ) {
      yield* update(row.id, { last_active_at: at })
      const isAlive = yield* keepAlive(row, timing.idle).pipe(
        Effect.as(true),
        Effect.catchTag("MachineProvider.Gone", () =>
          update(row.id, { phase: "replacing" }).pipe(Effect.andThen(ensure(row.id)), Effect.as(false)),
        ),
        Effect.catch((error) => Effect.logWarning("keepAlive failed", error).pipe(Effect.as(true))),
      )
      if (!isAlive) return { _tag: "Starting", phase: "replacing" } as const
      return { _tag: "Ready", target: target.value } as const
    }
    if (row.phase === "failed" && !(row.retry_at && row.retry_at.getTime() <= at.getTime()))
      return { _tag: "Failed", reason: row.failure ?? `The ${noun.toLowerCase()} failed` } as const
    if (row.phase === "failed") yield* restart(row, row.retries + 1)
    yield* ensure(id)
    const shown: Partial<Record<Machine.Phase, string>> = { ready: "resuming", capacity: "waiting for capacity" }
    return { _tag: "Starting", phase: shown[row.phase] ?? row.phase } as const
  })

  // oxlint-disable-next-line ren/no-comments -- Networking rule 4: an awake machine gets its owner's new host list at once, and the provider hears nothing while the list is the same. A paused one gets it at its wake.
  const refreshNetwork = Effect.fn(`${name}.refreshNetwork`)(function* (id: Id) {
    const row = yield* read(id)
    const at = yield* now
    if (!row.binding || row.phase !== "ready" || !(row.keep_alive_until && row.keep_alive_until > at)) return
    const applied = yield* definition.appliedHosts(row)
    const hosts = Option.getOrNull(applied)
    if (JSON.stringify(hosts) === JSON.stringify(row.network_hosts)) return
    const provider = yield* definition.providerOf(row)
    yield* provider.updateNetwork(row.binding, { proxy: yield* proxyOf(row, provider), hosts: applied }).pipe(
      Effect.andThen(update(row.id, { network_hosts: hosts })),
      Effect.catch((error) => Effect.logWarning(`${noun} ${row.id} did not get its new host list`, error)),
      annotate(row),
    )
  })

  const lifecycle = {
    run,
    refreshNetwork,
    keepAwake,
    forceReplace,
    rest,
    access,
    ensure,
    check,
    // oxlint-disable-next-line ren/no-comments -- HR12: reads the row only. It never calls ensure or touch, so it never resumes a paused machine or extends a keep-alive. A machine past its keep-alive may be paused, so it has no target.
    awake: Effect.fn(`${name}.awake`)(function* (id: Id) {
      const row = yield* read(id)
      const at = yield* now
      return row.phase === "ready" && row.keep_alive_until && row.keep_alive_until.getTime() > at.getTime()
        ? definition.target(row)
        : Option.none()
    }),
    ready: Effect.fn(`${name}.ready`)(function* (id: Id) {
      const wait = Effect.gen(function* () {
        const result = yield* access(id)
        if (result._tag === "Ready") return Option.some(result.target)
        if (result._tag === "Failed") return yield* new Unavailable({ message: result.reason })
        return Option.none<Target>()
      }).pipe(Effect.withTracerEnabled(false))
      const within = Duration.sum(definition.bootWithin, definition.wakeWithin)
      return yield* wait.pipe(
        Effect.repeat({ until: Option.isSome, schedule: Schedule.spaced(timing.poll) }),
        Effect.timeoutOrElse({
          duration: within,
          orElse: () =>
            Effect.fail(new Starting({ message: `${noun} ${id} is still starting after ${Duration.format(within)}` })),
        }),
        Effect.flatMap((found) =>
          Option.isSome(found)
            ? Effect.succeed(found.value)
            : Effect.fail(new Unavailable({ message: `${noun} ${id} did not get ready` })),
        ),
      )
    }),
    retry: Effect.fn(`${name}.retry`)(function* (id: Id) {
      const row = yield* read(id)
      if (row.phase === "failed") yield* restart(row, 0)
      yield* ensure(id)
    }),
  }
  return lifecycle satisfies MachineAccess.Interface<Id, Target>
}
