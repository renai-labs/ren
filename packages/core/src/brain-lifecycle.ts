export * as BrainLifecycle from "./brain-lifecycle.js"

import { Observability } from "@ren/schema/observability"
import { Database } from "@ren/db/database"
import type { State as BrainState, UpdateBody } from "@ren/host-api/brain-api"
import type { PullSession } from "@ren/host-api/ren-host-api"
import { Brain } from "@ren/schema/brain"
import type { Bundle } from "@ren/schema/bundle"
import { Environment } from "@ren/schema/environment"
import { Signature } from "@ren/schema/signature"
import type { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { and, eq, exists, gt, inArray, isNotNull, isNull, lt, notExists, notInArray, or, sql } from "drizzle-orm"
import {
  Clock,
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Stream,
} from "effect"
import { WorkflowEngine } from "effect/workflow"
import { BrainClient } from "./brain-client.js"
import { Bundles } from "./bundles.js"
import { DurableRunner } from "./durable-runner.js"
import { Deployment } from "./deployment.js"
import { EnvironmentNetwork } from "./environment-network.js"
import { Environments } from "./environments.js"
import type { MachineAccess } from "./machine-access.js"
import { MachineLifecycle } from "./machine-lifecycle.js"
import { Models } from "./models.js"
import { BrainProvider } from "./brain-provider.js"
import { MachineProvider } from "./machine-provider.js"
import { SandboxEgress } from "./sandbox-egress.js"

export type Access = MachineAccess.Access<BrainClient.Target>

export interface Interface extends MachineAccess.Interface<Brain.ID, BrainClient.Target> {
  readonly ready: (brainId: Brain.ID) => Effect.Effect<BrainClient.Target, MachineLifecycle.Unavailable>
  readonly awake: (brainId: Brain.ID) => Effect.Effect<Option.Option<BrainClient.Target>>
  readonly observe: (brainId: Brain.ID, sessions: ReadonlyArray<PullSession>) => Effect.Effect<void>
  readonly hand: (brainId: Brain.ID) => Effect.Effect<Option.Option<Hand>>
  readonly cleanup: Effect.Effect<void>
  readonly onInterrupted: (listener: (interrupted: Interrupted) => Effect.Effect<void>) => Effect.Effect<void>
}

// oxlint-disable-next-line ren/no-comments -- The chats that a lost sandbox stopped mid-turn. A repeated loss (within timing.relapse of the last one) fails them instead, so the next step is a person's, not another sandbox that dies the same way.
export interface Interrupted {
  readonly brainId: Brain.ID
  readonly sessionIds: ReadonlyArray<Session.ID>
  readonly repeated: boolean
}

export const timing = {
  pull: Duration.seconds(90),
  relapse: Duration.minutes(30),
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/BrainLifecycle") {}

// oxlint-disable-next-line ren/no-comments -- The brain's own machine as an environment. It is behind the egress when its brain is (R19).
export interface Hand extends MachineProvider.Hand {
  readonly egress: boolean
  readonly canMount: boolean
}

const CleanupRun = DurableRunner.make("BrainCleanup", {
  payload: { day: Schema.String },
  idempotencyKey: (payload) => `cleanup:${payload.day}`,
})

const BrainRun = DurableRunner.make("BrainRun", {
  payload: { brainId: Brain.ID, epoch: Schema.Int },
  idempotencyKey: (payload) => `brain:${payload.brainId}:${payload.epoch}`,
})

const brains = Database.Schema.brain

// oxlint-disable-next-line ren/no-comments -- Package installs at a wake can take minutes; a build that runs longer fails (templates rule 3).
const stepsWithin = Duration.minutes(10)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const registry = yield* BrainProvider.Registry
    const client = yield* BrainClient.Service
    const engine = yield* WorkflowEngine.WorkflowEngine
    const environments = yield* Environments.Service
    const egress = yield* SandboxEgress.Service
    const code = yield* Bundles.Service
    const wakeWithin = yield* Config.Duration("BRAIN_WAKE_TIMEOUT").pipe(
      Config.withDefault(MachineLifecycle.timing.wake),
    )
    const bootWithin = yield* Config.Duration("BRAIN_BOOT_TIMEOUT").pipe(
      Config.withDefault(MachineLifecycle.timing.boot),
    )
    const pullWithin = yield* Config.Duration("BRAIN_PULL_TIMEOUT").pipe(Config.withDefault(timing.pull))
    const sandboxVariables = yield* Deployment.sandboxVariables
    const scope = yield* Effect.scope
    const interruptedListeners = yield* Ref.make<ReadonlyArray<(interrupted: Interrupted) => Effect.Effect<void>>>([])
    const network = yield* EnvironmentNetwork.Service
    const models = yield* Models.Service
    // oxlint-disable-next-line ren/no-comments -- EN40: a co-located machine runs the brain too, so a limited host list also has Ren's server and the inference address that brains are given, which can differ from Ren's own.
    const renHosts = [
      client.renUrl,
      ...Option.toArray(Option.map(yield* models.inference, (found) => found.baseUrl)),
    ].flatMap((url) => Option.toArray(Option.fromNullishOr(URL.parse(url)?.hostname)))

    const read = (brainId: Brain.ID) =>
      database.db
        .select()
        .from(brains)
        .where(eq(brains.id, brainId))
        .pipe(
          Effect.orDie,
          Effect.flatMap((rows) =>
            Option.match(Option.fromNullishOr(rows.at(0)), {
              onNone: () => Effect.die(new Error(`Brain ${brainId} does not exist`)),
              onSome: Effect.succeed,
            }),
          ),
        )

    const update = (brainId: Brain.ID, values: Partial<typeof brains.$inferInsert>) =>
      database.db.update(brains).set(values).where(eq(brains.id, brainId)).pipe(Effect.orDie, Effect.asVoid)

    type Row = typeof brains.$inferSelect

    const targetOf = (row: Row): Option.Option<BrainClient.Target> =>
      row.url
        ? Option.some({
            brainId: row.id,
            generation: row.generation,
            organizationId: row.organization_id,
            url: row.url,
            keyIds: row.key_ids,
            egress: row.egress,
          })
        : Option.none()

    const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis))

    // oxlint-disable-next-line ren/no-comments -- EN35, EN36: unless the loss repeats, each top chat of the brain that was busy or had waiting messages is marked to get one message that continues it on the new machine; then its busy chats end with the outcome.
    const interruptBusy = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      brainId: Brain.ID,
      at: Date,
      outcome: "interrupted" | "failed",
    ) {
      const chats = Database.Schema.agent_session
      if (outcome === "interrupted")
        yield* transaction
          .update(chats)
          .set({ continue_message_id: sql`'msg_' || replace(gen_random_uuid()::text, '-', '')` })
          .where(
            and(
              eq(chats.brain_id, brainId),
              isNull(chats.parent_id),
              isNull(chats.continue_message_id),
              or(
                exists(
                  transaction
                    .select({ id: Database.Schema.opencode_session.session_id })
                    .from(Database.Schema.opencode_session)
                    .where(
                      and(
                        eq(Database.Schema.opencode_session.session_id, chats.id),
                        isNotNull(Database.Schema.opencode_session.time_suspended),
                      ),
                    ),
                ),
                exists(
                  transaction
                    .select({ id: Database.Schema.opencode_inbox.id })
                    .from(Database.Schema.opencode_inbox)
                    .where(eq(Database.Schema.opencode_inbox.session_id, chats.id)),
                ),
              ),
            ),
          )
      return yield* transaction
        .update(Database.Schema.opencode_session)
        .set({ time_suspended: null, idle_outcome: outcome, time_idle: at.getTime() })
        .where(
          and(
            inArray(
              Database.Schema.opencode_session.session_id,
              transaction
                .select({ id: Database.Schema.agent_session.id })
                .from(Database.Schema.agent_session)
                .where(eq(Database.Schema.agent_session.brain_id, brainId)),
            ),
            isNotNull(Database.Schema.opencode_session.time_suspended),
          ),
        )
        .returning({ id: Database.Schema.opencode_session.session_id })
    })

    const forceReplace = Effect.fn("BrainLifecycle.forceReplace")(function* (
      brainId: Brain.ID,
      generation: number,
      at: Date,
    ) {
      const interrupted = yield* database
        .transaction((transaction) =>
          Effect.gen(function* () {
            const found = (yield* transaction
              .select({ lostAt: brains.lost_at })
              .from(brains)
              .where(
                and(
                  eq(brains.id, brainId),
                  eq(brains.generation, generation),
                  notInArray(brains.phase, ["creating", "replacing"]),
                ),
              )
              .for("update")).at(0)
            if (!found) return Option.none<Interrupted>()
            yield* transaction.update(brains).set({ phase: "replacing", lost_at: at }).where(eq(brains.id, brainId))
            const repeated = Option.exists(
              Option.fromNullishOr(found.lostAt),
              (last) => at.getTime() - last.getTime() < Duration.toMillis(timing.relapse),
            )
            yield* Effect.logWarning(
              repeated
                ? `The sandbox of brain ${brainId} is gone again within ${Duration.format(timing.relapse)}; its busy chats fail`
                : `The sandbox of brain ${brainId} is gone; its busy chats are interrupted`,
            )
            const sessions = yield* interruptBusy(transaction, brainId, at, repeated ? "failed" : "interrupted")
            return Option.some({ brainId, sessionIds: sessions.map((session) => session.id), repeated })
          }),
        )
        .pipe(Effect.orDie)
      if (Option.isNone(interrupted)) return false
      yield* Effect.forEach(
        yield* Ref.get(interruptedListeners),
        (listener) =>
          listener(interrupted.value).pipe(
            Effect.catchCause((cause) => Effect.logError("A lost sandbox's chats could not be handled", cause)),
          ),
        { discard: true },
      ).pipe(Effect.withErrorReporting, Effect.forkIn(scope))
      return true
    })

    // oxlint-disable-next-line ren/no-comments -- The current bundles, the dependencies first, when this Ren serves bundles; none for a host whose image or folder holds Ren's code.
    const currentBundles = Effect.map(
      Effect.forEach(["dependencies", "brain", "executor"] as const, code.current),
      (found) => Option.all(found),
    )
    const versionsOf = (bundles: ReadonlyArray<Bundle.Info>) => {
      const version = (kind: Bundle.Kind) => bundles.find((bundle) => bundle.kind === kind)?.version ?? ""
      return { dependencies: version("dependencies"), brain: version("brain"), executor: version("executor") }
    }
    const withTokens = (bundles: ReadonlyArray<Bundle.Info>) =>
      Effect.forEach(bundles, (bundle) =>
        Effect.map(code.token(bundle), (token) => ({
          kind: bundle.kind,
          version: bundle.version,
          sha256: bundle.sha256,
          token,
        })),
      )
    const treeOf = (versions: Readonly<Record<Bundle.Kind, string>>) => `${versions.brain}-${versions.dependencies}`
    const isCurrent = (row: Row, bundles: ReadonlyArray<Bundle.Info>) => {
      const versions = versionsOf(bundles)
      return (["dependencies", "brain", "executor"] as const).every((kind) => row.bundles?.[kind] === versions[kind])
    }

    // oxlint-disable-next-line ren/no-comments -- A brain goes behind the egress when this Ren runs one and its provider can route a sandbox through it. The answer is kept on the row (egress); every later step reads the row, never the setting.
    const isBehindEgress = (provider: MachineProvider.Provider) => egress.enabled && provider.canEgress

    // oxlint-disable-next-line ren/no-comments -- The provider the brain's space chose, or the deployment's first one. Ren does not start when a space names one it does not register (EN24).
    const providerOfSpace = Effect.fnUntraced(function* (spaceId: Space.ID) {
      const row = (yield* database.db
        .select({ provider: Database.Schema.space.brain_provider })
        .from(Database.Schema.space)
        .where(eq(Database.Schema.space.id, spaceId))
        .pipe(Effect.orDie)).at(0)
      const found = row?.provider ? registry.get(row.provider) : Option.fromNullishOr(registry.providers.at(0))
      if (Option.isNone(found))
        return yield* Effect.die(new Error(`No brain provider ${row?.provider ?? ""} in this Ren`))
      return found.value
    })

    const providerOf = (row: Row) =>
      row.provider
        ? Option.match(registry.get(row.provider), {
            onNone: () =>
              Effect.die(new Error(`Brain ${row.id} runs on ${row.provider}, which this Ren does not register`)),
            onSome: Effect.succeed,
          })
        : providerOfSpace(row.space_id)

    // oxlint-disable-next-line ren/no-comments -- A brain is made for its space's hand at create. A brain for a remote hand runs OpenCode's tool output, files and git on the hand; a change to or from remote replaces the brain at its wake, so the choice at boot holds for the process's life (EN13).
    const handPlacement = Effect.fnUntraced(function* (spaceId: Space.ID) {
      const found = (yield* database.db
        .select({ placement: Database.Schema.space.hand_placement })
        .from(Database.Schema.space)
        .where(eq(Database.Schema.space.id, spaceId))
        .pipe(Effect.orDie)).at(0)
      return found?.placement ?? Space.defaultHand.placement
    })

    // oxlint-disable-next-line ren/no-comments -- A co-located hand with a template: the machine runs the template's last image that built, and keeps to its host list (EN3, networking rules 1, 2).
    const desiredSetup = Effect.fnUntraced(function* (row: Row) {
      const templates = Database.Schema.environment_template
      const found = (yield* database.db
        .select({
          placement: Database.Schema.space.hand_placement,
          id: templates.id,
          image: templates.image,
          config: templates.image_config,
          networking: templates.networking,
        })
        .from(Database.Schema.space)
        .leftJoin(
          templates,
          and(eq(templates.id, Database.Schema.space.environment_template_id), isNull(templates.archived_at)),
        )
        .where(eq(Database.Schema.space.id, row.space_id))
        .pipe(Effect.orDie)).at(0)
      if (found?.placement !== "colocated" || !found.id || !found.networking)
        return { config: {}, image: Option.none(), hosts: Option.none() } satisfies MachineLifecycle.DesiredSetup
      const template = { environmentTemplateId: found.id, config: found.config }
      const hosts = yield* network.hostsOf({ kind: "brain", id: row.id, generation: row.generation }, found.networking)
      return {
        config: {},
        image: Option.map(
          Option.all({ name: Option.fromNullishOr(found.image), config: Option.fromNullishOr(template.config) }),
          (built) => ({
            name: built.name,
            template: { environmentTemplateId: template.environmentTemplateId, config: built.config },
          }),
        ),
        hosts: Option.map(hosts, (list) => [...new Set([...list, ...renHosts])]),
      } satisfies MachineLifecycle.DesiredSetup
    })

    const machines = MachineLifecycle.make({
      name: "BrainLifecycle",
      noun: "Brain",
      annotation: "brain",
      kind: "brain",
      providerOf,
      isBehindEgress,
      bootWithin,
      wakeWithin,
      read,
      update,
      replace: (row, at) =>
        database
          .transaction((transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .update(brains)
                .set({
                  generation: sql`${brains.generation} + 1`,
                  binding: null,
                  url: null,
                  keep_alive_until: null,
                  phase: "creating",
                })
                .where(eq(brains.id, row.id))
              yield* interruptBusy(transaction, row.id, at, "interrupted")
            }),
          )
          .pipe(Effect.orDie),
      forceReplace,
      isNeeded: (brainId) =>
        database.db
          .select({ id: Database.Schema.agent_session.id })
          .from(Database.Schema.agent_session)
          .where(
            and(
              eq(Database.Schema.agent_session.brain_id, brainId),
              isNotNull(Database.Schema.agent_session.continue_message_id),
            ),
          )
          .limit(1)
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.length > 0),
          ),
      ensure: (row) =>
        DurableRunner.ensure(BrainRun, { brainId: row.id, epoch: row.run_epoch }).pipe(
          Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
        ),
      proxyFor: (row) =>
        egress.proxyFor({
          workload: { kind: "brain", id: row.id, generation: row.generation },
          organizationId: row.organization_id,
        }),
      retire: (brainId) => egress.retire({ kind: "brain", id: brainId }),
      desiredSetup,
      startup: Effect.fnUntraced(function* (row) {
        const bundles = yield* currentBundles
        const placement = yield* handPlacement(row.space_id)
        const variables = {
          REN_URL: client.renUrl,
          REN_BRAIN_ID: row.id,
          REN_BRAIN_GENERATION: String(row.generation),
          BRAIN_PUBLIC_KEYS: Schema.encodeSync(Signature.PublicKeys)(client.publicKeys),
          ...sandboxVariables({
            "ren.organization.id": row.organization_id,
            "ren.space.id": row.space_id,
            "ren.brain.id": row.id,
            "ren.brain.generation": String(row.generation),
          }),
          ...(yield* environments.executorVariables(Environment.ofBrain(row.id))),
          ...(placement === "remote" && { REN_HAND_PLACEMENT: "remote" }),
          ...(Option.isSome(bundles) && {
            REN_BUNDLES: (yield* withTokens(bundles.value))
              .map((bundle) => [bundle.kind, bundle.version, bundle.sha256, bundle.token].join(":"))
              .join(" "),
          }),
        }
        return {
          variables,
          created: update(row.id, {
            hand_placement: placement,
            key_ids: client.publicKeys.map((key) => key.id),
            bundles: Option.match(bundles, { onNone: () => null, onSome: versionsOf }),
          }),
        }
      }),
      target: targetOf,
      boot: Effect.fnUntraced(function* (target, within) {
        const api = yield* client.brain(target)
        const answered = { last: Option.none<BrainState>() }
        // oxlint-disable-next-line ren/no-comments -- Ready means the brain answers and has reached Ren with a pull, so a brain whose path to Ren is broken (egress, CA, DNS) fails with that reason instead of looking ready (M1; ren-v1 INV-15). An older brain does not report pulledAt.
        const state = yield* api.brain["brain.state"]().pipe(
          Effect.tap((found) =>
            Effect.sync(() => {
              answered.last = Option.some(found)
            }),
          ),
          Effect.flatMap((found) =>
            // ast-grep-ignore: no-nullish-comparison, -- null is "not yet pulled"; an older brain leaves pulledAt out and is not waited for
            found.pulledAt === null
              ? Effect.fail(new MachineLifecycle.Unavailable({ message: "not reached Ren" }))
              : Effect.succeed(found),
          ),
          Effect.retry({ schedule: Schedule.spaced(MachineLifecycle.timing.poll) }),
          Effect.timeoutOption(within),
        )
        if (Option.isSome(state))
          return yield* update(target.brainId, { last_pulled_at: yield* now }).pipe(Effect.as(Option.none()))
        return Option.some(
          Option.isSome(answered.last)
            ? `The brain answers but did not reach Ren within ${Duration.format(within)}`
            : `The brain did not answer within ${Duration.format(within)}`,
        )
      }),
      wake: Effect.fnUntraced(function* (target, within) {
        const api = yield* client.brain(target)
        const woke = yield* api.brain["brain.wake"]().pipe(
          Effect.retry({ schedule: Schedule.spaced(MachineLifecycle.timing.poll) }),
          Effect.timeoutOption(within),
        )
        if (Option.isSome(woke))
          return yield* update(target.brainId, { last_pulled_at: yield* now }).pipe(Effect.as(true))
        // oxlint-disable-next-line ren/no-comments -- A slow wake is not a dead brain: Ren replaces it only when /ren/state does not answer either (E132).
        const answers = yield* api.brain["brain.state"]().pipe(Effect.timeoutOption("10 seconds"), Effect.option)
        if (Option.isNone(answers) || Option.isNone(answers.value)) {
          yield* Effect.logWarning(
            `Brain ${target.brainId} did not confirm its wake in time and does not answer; Ren replaces it`,
          )
          return false
        }
        yield* Effect.logWarning(
          `Brain ${target.brainId} answers but did not confirm its wake within ${Duration.format(within)}`,
        )
        return yield* update(target.brainId, { last_pulled_at: yield* now }).pipe(Effect.as(true))
      }),
      changeAtWake: Effect.fnUntraced(function* (row) {
        if (row.provider && row.provider !== (yield* providerOfSpace(row.space_id)).info.id) return "replace" as const
        if ((row.hand_placement === "remote") !== ((yield* handPlacement(row.space_id)) === "remote"))
          return "replace" as const
        const bundles = yield* currentBundles
        if (Option.isNone(bundles)) return "current" as const
        if (!row.bundles) return "replace" as const
        return isCurrent(row, bundles.value) ? ("current" as const) : ("update" as const)
      }),
      // oxlint-disable-next-line ren/no-comments -- The brain unpacks the bundles and restarts what changed; the update counts when the brain answers with the new version within the boot time (EN27). Then, on its current code, it runs its template's new steps (EN22).
      updateInPlace: Effect.fnUntraced(function* (row, target, steps) {
        const bundles = yield* currentBundles
        const api = yield* client.brain(target)
        const send = (payload: typeof UpdateBody.Type, within: Duration.Duration) =>
          api.brain["brain.update"]({ payload }).pipe(
            Effect.timeoutOption(within),
            Effect.map((answered) =>
              Option.isSome(answered) ? Option.none() : Option.some("the brain did not answer"),
            ),
            Effect.catch((error) => Effect.succeed(Option.some(error.message))),
          )
        const current = Option.isSome(bundles) ? yield* withTokens(bundles.value) : []
        if (Option.isSome(bundles) && !isCurrent(row, bundles.value)) {
          const sent = yield* send({ bundles: current }, bootWithin)
          if (Option.isSome(sent)) return sent
          const tree = treeOf(versionsOf(bundles.value))
          const answered = yield* api.brain["brain.state"]().pipe(
            Effect.flatMap((state) =>
              state.version === tree ? Effect.succeed(state) : Effect.fail(new Error(`still ${state.version}`)),
            ),
            Effect.retry({ schedule: Schedule.spaced(MachineLifecycle.timing.poll) }),
            Effect.timeoutOption(bootWithin),
            Effect.option,
          )
          if (Option.isNone(answered) || Option.isNone(answered.value))
            return Option.some(`the brain did not answer with version ${tree} within ${Duration.format(bootWithin)}`)
          yield* update(row.id, { bundles: versionsOf(bundles.value) })
        }
        if (steps.length === 0) return Option.none()
        return yield* send({ bundles: current, steps }, stepsWithin)
      }),
      answers: (target) =>
        client.brain(target).pipe(
          Effect.flatMap((api) => api.brain["brain.state"]()),
          Effect.timeoutOption(MachineLifecycle.timing.probeTimeout),
          Effect.option,
          Effect.map((answered) => Option.isSome(answered) && Option.isSome(answered.value)),
        ),
    })

    yield* Stream.mergeAll(
      registry.providers.map((provider) => provider.lost),
      { concurrency: "unbounded" },
    ).pipe(
      Stream.runForEach((lost) =>
        lost.kind === "brain"
          ? machines.forceReplace({ id: lost.id, generation: lost.generation }, "its machine is gone")
          : Effect.void,
      ),
      Effect.withErrorReporting,
      Effect.forkScoped,
    )

    // oxlint-disable-next-line ren/no-comments -- An awake brain pulls every 30 s, also when no person or call uses it. A ready brain whose keep-alive runs and that has not pulled within pullWithin is checked, so a frozen sandbox or a silent brain is found without an access (EN16, EN17). Right after Ren starts, no pull has reached it yet, so it waits one pullWithin first.
    yield* Effect.gen(function* () {
      const at = yield* now
      const silent = yield* database.db
        .select({ id: brains.id })
        .from(brains)
        .where(
          and(
            eq(brains.phase, "ready"),
            gt(brains.keep_alive_until, at),
            or(
              isNull(brains.last_pulled_at),
              lt(brains.last_pulled_at, new Date(at.getTime() - Duration.toMillis(pullWithin))),
            ),
          ),
        )
        .pipe(Effect.orDie)
      yield* Effect.forEach(silent, (row) => machines.check(row.id), { concurrency: 8, discard: true })
    }).pipe(
      Effect.repeat(Schedule.spaced(Duration.divideUnsafe(pullWithin, 3))),
      Effect.delay(pullWithin),
      Effect.withErrorReporting,
      Effect.forkScoped,
    )

    // oxlint-disable-next-line ren/no-comments -- At boot, Ren reaches each running brain once, so its server token carries Ren's current address (E119). Asleep brains learn it at their wake.
    yield* Effect.gen(function* () {
      const running = yield* database.db
        .select()
        .from(brains)
        .where(and(eq(brains.phase, "ready"), gt(brains.keep_alive_until, yield* now)))
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        running,
        (row) =>
          Option.match(targetOf(row), {
            onNone: () => Effect.void,
            onSome: (target) =>
              client.brain(target).pipe(
                Effect.flatMap((api) => api.brain["brain.state"]()),
                Effect.timeout(MachineLifecycle.timing.wake),
                Effect.catchCause((cause) =>
                  Effect.logWarning(`Brain ${row.id} did not answer Ren's boot call`, cause),
                ),
              ),
          }),
        { concurrency: 8, discard: true },
      )
    }).pipe(Effect.withErrorReporting, Effect.forkScoped)

    const cleanup = Effect.gen(function* () {
      const chats = Database.Schema.agent_session
      const resting = yield* database.db
        .select({ brain: brains })
        .from(brains)
        .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, brains.space_id))
        .where(
          and(
            isNotNull(brains.binding),
            or(
              isNotNull(Database.Schema.space.archived_at),
              notExists(
                database.db
                  .select({ id: chats.id })
                  .from(chats)
                  .where(and(eq(chats.brain_id, brains.id), isNull(chats.archived_at))),
              ),
            ),
          ),
        )
        .pipe(Effect.orDie)
      yield* Effect.forEach(
        resting,
        (row) =>
          machines
            .rest(row.brain)
            .pipe(Effect.catch((error) => Effect.logWarning(`Cleanup of brain ${row.brain.id} failed`, error))),
        { discard: true },
      )
      const listed = (yield* Effect.forEach(registry.providers, (provider) =>
        provider.list.pipe(
          Effect.map((all) => all.map((each) => ({ ...each, provider }))),
          Effect.catch((error) =>
            Effect.logWarning(`Cleanup could not list the machines of ${provider.info.id}`, error).pipe(Effect.as([])),
          ),
        ),
      ))
        .flat()
        .flatMap((each) =>
          each.kind === "brain"
            ? [{ binding: each.binding, brainId: each.id, generation: each.generation, provider: each.provider }]
            : [],
        )
      const known = new Map(
        (yield* database.db
          .select({ id: brains.id, generation: brains.generation })
          .from(brains)
          .where(
            inArray(
              brains.id,
              listed.map((each) => each.brainId),
            ),
          )
          .pipe(Effect.orDie)).map((each) => [each.id, each.generation]),
      )
      yield* Effect.forEach(
        listed.filter((each) => known.get(each.brainId) !== each.generation),
        (each) =>
          each.provider
            .destroy(each.binding)
            .pipe(Effect.catch((error) => Effect.logWarning(`Cleanup of a sandbox of ${each.brainId} failed`, error))),
        { discard: true },
      )
      const busy = yield* database.db
        .selectDistinct({ brainId: chats.brain_id })
        .from(chats)
        .innerJoin(Database.Schema.opencode_session, eq(Database.Schema.opencode_session.session_id, chats.id))
        .where(isNotNull(Database.Schema.opencode_session.time_suspended))
        .pipe(Effect.orDie)
      yield* Effect.forEach(busy, (each) => machines.check(each.brainId), { discard: true })
    }).pipe(Effect.withSpan("BrainLifecycle.cleanup"))

    yield* DurableRunner.register(CleanupRun, (payload) => DurableRunner.supervise(`cleanup:${payload.day}`, cleanup))

    yield* Effect.gen(function* () {
      const day = DateTime.formatIsoDateUtc(yield* DateTime.now)
      yield* DurableRunner.ensure(CleanupRun, { day })
    }).pipe(
      Effect.repeat(Schedule.spaced("1 hour")),
      Effect.provideService(WorkflowEngine.WorkflowEngine, engine),
      Effect.withErrorReporting,
      Effect.forkScoped,
    )

    yield* DurableRunner.register(BrainRun, (payload) =>
      DurableRunner.supervise(
        `brain:${payload.brainId}`,
        machines
          .run(payload.brainId)
          .pipe(Observability.Trace.brainRun, Effect.annotateSpans("ren.brain.id", payload.brainId)),
      ).pipe(
        Effect.andThen(
          database.db
            .update(brains)
            .set({ run_epoch: payload.epoch + 1 })
            .where(and(eq(brains.id, payload.brainId), eq(brains.run_epoch, payload.epoch)))
            .pipe(Effect.orDie),
        ),
      ),
    )

    return Service.of({
      ensure: machines.ensure,
      access: machines.access,
      check: machines.check,
      retry: machines.retry,
      awake: machines.awake,
      ready: machines.ready,
      observe: Effect.fn("BrainLifecycle.observe")(function* (brainId: Brain.ID, sessions: ReadonlyArray<PullSession>) {
        const row = yield* read(brainId)
        const at = yield* now
        const previous = row.progress ?? {}
        const busy = sessions.filter((session) => session.busy)
        const progressed = busy.some((session) => previous[session.id] !== session.progress)
        const lastProgress = progressed ? at : row.last_progress_at
        yield* update(brainId, {
          progress: Object.fromEntries(sessions.map((session) => [session.id, session.progress])),
          last_pulled_at: at,
          ...(progressed && { last_progress_at: at }),
        })
        yield* machines.keepAwake(
          { ...row, last_progress_at: lastProgress },
          { isBusy: busy.length > 0, hasBackground: sessions.some((session) => session.background === true) },
        )
      }),
      cleanup,
      onInterrupted: Effect.fn("BrainLifecycle.onInterrupted")(function* (
        listener: (interrupted: Interrupted) => Effect.Effect<void>,
      ) {
        yield* Ref.update(interruptedListeners, (listeners) => [...listeners, listener])
      }),
      hand: Effect.fn("BrainLifecycle.hand")(function* (brainId: Brain.ID) {
        const row = yield* read(brainId)
        if (!row.binding) return Option.none()
        const provider = yield* providerOf(row)
        return Option.some({
          ...(yield* provider.hand(row.binding).pipe(Effect.orDie)),
          egress: row.egress,
          canMount: provider.canMount,
        })
      }),
    })
  }),
)
