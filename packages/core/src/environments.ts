export * as Environments from "./environments.js"

import { Observability } from "@ren/schema/observability"
import { ExecutorVariables } from "@ren/environment-api/executor-variables"
import type { EnvironmentToken } from "@ren/environment-api/environment-token"
import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Environment } from "@ren/schema/environment"
import type { Session } from "@ren/schema/session"
import type { Bundle } from "@ren/schema/bundle"
import type { Machine } from "@ren/schema/machine"
import type { Space } from "@ren/schema/space"
import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  notExists,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import {
  Clock,
  Config,
  Context,
  DateTime,
  Duration,
  Effect,
  Fiber,
  FiberMap,
  Layer,
  Option,
  Redacted,
  Schema,
  Struct,
} from "effect"
import { HttpClient } from "effect/http"
import { Bundles } from "./bundles.js"
import { Deployment } from "./deployment.js"
import { EnvironmentNetwork } from "./environment-network.js"
import { EnvironmentProvider } from "./environment-provider.js"
import { MachineLifecycle } from "./machine-lifecycle.js"
import { SandboxEgress } from "./sandbox-egress.js"
import { MachineProvider } from "./machine-provider.js"
import { Signer } from "./signer.js"

interface Subject {
  readonly sessionId: Session.ID
  readonly organizationId: Auth.OrganizationID
}

export interface Placement {
  readonly organizationId: Auth.OrganizationID
  readonly spaceId: Space.ID
}

export interface Hand {
  readonly brainId: Brain.ID
  readonly generation: number
  readonly url: string
  readonly workspace: Environment.Directory
  readonly egress: boolean
  readonly canMount: boolean
}

export interface Capability {
  readonly canMount: boolean
  readonly egress: boolean
}

interface Bound {
  readonly directory: Environment.Directory
  readonly isNew: boolean
}

export interface Interface {
  // oxlint-disable-next-line ren/no-comments -- Binds a new chat to the template version of the hand its brain applied.
  readonly bind: (placement: Subject & Placement, version: Machine.Version) => Effect.Effect<Bound, NotFound | Changed>
  readonly findDirectory: (
    subject: Subject,
    hand: Option.Option<Hand>,
  ) => Effect.Effect<Option.Option<Environment.Directory>>
  readonly capabilities: (
    organizationId: Auth.OrganizationID,
    sessionIds: ReadonlyArray<Session.ID>,
    hand: Option.Option<Hand>,
  ) => Effect.Effect<ReadonlyMap<Session.ID, Capability>>
  readonly unbind: (subject: Subject) => Effect.Effect<void>
  // oxlint-disable-next-line ren/no-comments -- In the transaction that applies a brain's hand: binds each of its top chats to the hand's template version, or unbinds them for the brain's own machine or none. A chat whose version changes gets a machine of the new version at its next access.
  readonly apply: (
    transaction: Database.Transaction,
    brainId: Brain.ID,
    hand: Space.AppliedHand,
  ) => Effect.Effect<void, EffectDrizzleQueryError>
  // oxlint-disable-next-line ren/no-comments -- The folder where a remote hand of the provider keeps its chats' folders (EN42).
  readonly workspaceOf: (provider: EnvironmentProvider.ID) => string
  // oxlint-disable-next-line ren/no-comments -- EN15: `unreachable` when the brain could not reach the session's hand at its last URL; Ren checks that machine first.
  readonly access: (
    subject: Subject,
    hand: Option.Option<Hand>,
    options?: { readonly unreachable?: boolean },
  ) => Effect.Effect<Environment.Access, NotFound | Unavailable | Starting>
  // oxlint-disable-next-line ren/no-comments -- A turn, or a file or diff request, of each chat: a chat that holds a place on its machine keeps it for 3 more days. An expired place is taken again only at the chat's next access, when the machine has room.
  readonly renew: (sessionIds: ReadonlyArray<Session.ID>) => Effect.Effect<void>
  readonly keepAwake: (sessionIds: ReadonlyArray<Session.ID>, lastProgressAt: Date) => Effect.Effect<void>
  // oxlint-disable-next-line ren/no-comments -- Sends the awake remote hands of a space their new host list (networking rule 4).
  readonly refreshNetworks: (spaceId: Space.ID) => Effect.Effect<void>
  // oxlint-disable-next-line ren/no-comments -- The hosts the machines of a remote hand's template answer on. A brain with a host list must reach them.
  readonly handHosts: (environmentTemplateId: EnvironmentTemplate.ID) => Effect.Effect<ReadonlyArray<string>>
  // oxlint-disable-next-line ren/no-comments -- Daily: destroys each hand machine that no chat holds a place on and that runs no work, with its files. Then destroys the hand sandboxes that no row knows at their generation: a row that is gone or replaced, or a create that half worked.
  readonly cleanup: Effect.Effect<void>
  // oxlint-disable-next-line ren/no-comments -- A shutdown of the space: destroys each of its hand machines with their files. Its chats keep their bindings and get new machines at their next access. Returns what it could not destroy.
  readonly shutdown: (spaceId: Space.ID) => Effect.Effect<ReadonlyArray<string>>
  readonly executorVariables: (
    environmentId: Environment.ID,
    generation: number,
  ) => Effect.Effect<Readonly<Record<string, string>>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Environments") {}

export class NotFound extends Schema.TaggedError<NotFound>()("Environments.NotFound", { message: Schema.String }) {}

export class Changed extends Schema.TaggedError<Changed>()("Environments.Changed", { message: Schema.String }) {}

export class Unavailable extends Schema.TaggedError<Unavailable>()("Environments.Unavailable", {
  message: Schema.String,
}) {}

export class Starting extends Schema.TaggedError<Starting>()("Environments.Starting", { message: Schema.String }) {}

// oxlint-disable-next-line ren/no-comments -- An access waits this long for a hand's machine, under the 10 s for which Ren's server keeps a quiet connection (server main.ts, idleTimeout). A hand that takes longer answers Starting, and the brain asks again.
export const startingAfter = Duration.seconds(5)

// oxlint-disable-next-line ren/no-comments -- How long a chat holds its place on a hand machine after its last turn or file request.
export const reservation = Duration.days(3)

const templates = Database.Schema.environment_template
const environments = Database.Schema.environment

const versionsOf = (bundles: ReadonlyArray<Bundle.Info>) => {
  const version = (kind: Bundle.Kind) => bundles.find((bundle) => bundle.kind === kind)?.version ?? ""
  return { dependencies: version("dependencies"), executor: version("executor") }
}
const sessions = Database.Schema.session_environment
const spaces = Database.Schema.space

const isAvailable = (organizationId: Auth.OrganizationID) =>
  and(eq(templates.organization_id, organizationId), isNull(templates.archived_at))

// oxlint-disable-next-line ren/no-comments -- Where Ren reaches a remote hand's machine; its generation tells the brain when the files are new.
interface Target {
  readonly environmentId: Environment.ID
  readonly url: string
  readonly generation: number
  readonly egress: boolean
}

const isSessionOf = (subject: Subject) =>
  and(
    eq(sessions.session_id, subject.sessionId),
    exists(
      sql`(select 1 from ${spaces} where ${and(eq(spaces.id, sessions.space_id), eq(spaces.organization_id, subject.organizationId))})`,
    ),
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.all({
      lifetime: Config.Duration("ENVIRONMENT_TOKEN_LIFETIME").pipe(Config.withDefault(Duration.minutes(15))),
      directory: Config.String("ENVIRONMENT_DIRECTORY").pipe(Config.withDefault("/workspace")),
    })
    const database = yield* Database.Service
    const registry = yield* EnvironmentProvider.Registry
    // oxlint-disable-next-line ren/no-comments -- A remote hand goes through the egress as a brain does, with its own proxy login, so its processes get placeholders that work (C2).
    const sandboxEgress = yield* SandboxEgress.Service
    const isBehindEgress = (provider: MachineProvider.Provider) => sandboxEgress.enabled && provider.canEgress
    const sandboxVariables = yield* Deployment.sandboxVariables
    // oxlint-disable-next-line ren/no-comments -- EN42: a chat's folder on a remote hand is fixed when the chat starts, from the provider's workspace.
    const directoryOf = (provider: MachineProvider.Provider, sessionId: Session.ID) =>
      `${Option.getOrElse(provider.workspace, () => config.directory)}/${sessionId}`
    const signer = yield* Signer.Service
    const signingKeys = signer.publicKeys("environment").pipe(
      Effect.map((publicKeys) => ({ publicKeys })),
      Effect.orDie,
    )
    const signToken = (claims: Omit<EnvironmentToken.Claims, "typ" | "kid">) =>
      signer.sign("environment", { ...claims, typ: "environment" }).pipe(Effect.orDie)

    const expiry = Effect.map(Clock.currentTimeMillis, (now) =>
      Math.floor((now + Duration.toMillis(config.lifetime)) / 1000),
    )

    const isBound = (subject: Subject) =>
      database.db
        .select({ sessionId: sessions.session_id })
        .from(sessions)
        .where(isSessionOf(subject))
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.length > 0),
        )

    const handDirectory = (hand: Hand, sessionId: Session.ID) => `${hand.workspace}/${sessionId}`

    const checkAvailable = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      placement: Subject & Placement,
      environmentTemplateId: EnvironmentTemplate.ID,
    ) {
      const rows = yield* transaction
        .select({ provider: templates.provider })
        .from(templates)
        .where(and(eq(templates.id, environmentTemplateId), isAvailable(placement.organizationId)))
        .for("share")
      const provider = Option.flatMap(Option.fromNullishOr(rows.at(0)), (row) => registry.get(row.provider))
      if (Option.isNone(provider))
        return yield* new NotFound({
          message: `Environment template ${environmentTemplateId} is not available to this session’s space`,
        })
      return provider.value
    })

    const assign = Effect.fn("Environments.assign")(function* (subject: Subject) {
      yield* Effect.annotateCurrentSpan({
        "ren.session.id": subject.sessionId,
        "ren.organization.id": subject.organizationId,
      })
      const at = new Date(yield* Clock.currentTimeMillis)
      return yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const sessionRows = yield* transaction
            .select({
              spaceId: sessions.space_id,
              environmentTemplateId: sessions.environment_template_id,
              environmentId: sessions.environment_id,
              target: sessions.target,
              reservedUntil: sessions.reserved_until,
              generation: sessions.generation,
              brainId: Database.Schema.agent_session.brain_id,
            })
            .from(sessions)
            .innerJoin(spaces, eq(spaces.id, sessions.space_id))
            .innerJoin(Database.Schema.agent_session, eq(Database.Schema.agent_session.id, sessions.session_id))
            .where(and(eq(sessions.session_id, subject.sessionId), eq(spaces.organization_id, subject.organizationId)))
            .for("update", { of: sessions })
          const session = sessionRows.at(0)
          if (!session) return yield* new NotFound({ message: `Session ${subject.sessionId} has no environment` })
          // oxlint-disable-next-line ren/no-comments -- The template lock orders every assign and cleanup of its machines, on every Ren: two chats never take the last place at once.
          const templateRows = yield* transaction
            .select()
            .from(templates)
            .where(and(eq(templates.id, session.environmentTemplateId), isAvailable(subject.organizationId)))
            .for("update", { of: templates })
          const template = templateRows.at(0)
          if (!template)
            return yield* new NotFound({
              message: `The environment template of session ${subject.sessionId} is archived`,
            })
          // oxlint-disable-next-line ren/no-comments -- The machines of the chat's version in its space, oldest first, with the places that other chats hold on each now.
          const held = alias(sessions, "held")
          const machines = yield* transaction
            .select({ id: environments.id, held: count(held.session_id) })
            .from(environments)
            .leftJoin(
              held,
              and(
                eq(held.environment_id, environments.id),
                gt(held.reserved_until, at),
                ne(held.session_id, subject.sessionId),
              ),
            )
            .where(
              and(
                eq(environments.environment_template_id, template.id),
                eq(environments.space_id, session.spaceId),
                eq(environments.target, session.target),
              ),
            )
            .groupBy(environments.id, environments.created_at)
            .orderBy(asc(environments.created_at))
          const hasRoom = (machine: { readonly held: number }) => machine.held < template.sessions_per_environment
          const current = machines.find((machine) => machine.id === session.environmentId)
          // oxlint-disable-next-line ren/no-comments -- A chat keeps its machine while it holds its place there, also when the template now allows fewer chats per machine; with an expired place, only while the machine has room.
          const isKept = current && ((session.reservedUntil && session.reservedUntil > at) || hasRoom(current))
          const environmentId = isKept
            ? current.id
            : (machines.find(hasRoom)?.id ??
              (yield* Effect.gen(function* () {
                const id = Environment.ID.create()
                yield* transaction.insert(environments).values({
                  id,
                  environment_template_id: template.id,
                  space_id: session.spaceId,
                  target: session.target,
                })
                return id
              })))
          yield* transaction
            .update(sessions)
            .set({
              environment_id: environmentId,
              reserved_until: new Date(at.getTime() + Duration.toMillis(reservation)),
            })
            .where(eq(sessions.session_id, subject.sessionId))
          const environment = yield* transaction
            .select({ binding: environments.binding })
            .from(environments)
            .where(eq(environments.id, environmentId))
          return {
            template,
            environmentId,
            providerBinding: environment.at(0)?.binding ?? null,
            generation: session.generation,
            brainId: session.brainId,
            spaceId: session.spaceId,
          }
        }),
      )
    }, Observability.Trace.environmentAssign)

    const http = yield* HttpClient.HttpClient
    const code = yield* Bundles.Service
    const network = yield* EnvironmentNetwork.Service
    const renUrl = yield* Config.option(Config.String("REN_URL"))

    type Row = MachineLifecycle.Row<Environment.ID> & {
      readonly environment_template_id: EnvironmentTemplate.ID
      readonly target: Machine.Version
      readonly bundles: Readonly<Record<"dependencies" | "executor", string>> | null
    }

    // oxlint-disable-next-line ren/no-comments -- A hand runs the executor only: it gets the dependencies and the executor bundles, none when this Ren serves no bundles.
    const currentBundles = Effect.map(Effect.forEach(["dependencies", "executor"] as const, code.current), (found) =>
      Option.all(found),
    )

    const read = (environmentId: Environment.ID) =>
      database.db
        .select({ environment: environments, organizationId: templates.organization_id, provider: templates.provider })
        .from(environments)
        .innerJoin(templates, eq(templates.id, environments.environment_template_id))
        .where(eq(environments.id, environmentId))
        .pipe(
          Effect.orDie,
          Effect.flatMap((rows) => {
            const found = rows.at(0)
            const spaceId = found?.environment.space_id
            if (!found || !spaceId) return Effect.die(new Error(`Environment ${environmentId} has no space`))
            return Effect.succeed({
              ...found.environment,
              space_id: spaceId,
              organization_id: found.organizationId,
              provider: found.provider,
            } satisfies Row)
          }),
        )

    // oxlint-disable-next-line ren/no-comments -- The provider and the labels of a hand come from its template and space, so only its own columns change.
    const update = (
      environmentId: Environment.ID,
      values: Partial<MachineLifecycle.Row<Environment.ID>>,
      only?: Pick<MachineLifecycle.Row<Environment.ID>, "phase" | "generation">,
    ) =>
      database.db
        .update(environments)
        .set(Struct.omit(values, ["id", "organization_id", "space_id", "provider"]))
        .where(
          and(
            eq(environments.id, environmentId),
            only && eq(environments.phase, only.phase),
            only && eq(environments.generation, only.generation),
          ),
        )
        .pipe(Effect.orDie, Effect.asVoid)

    const providerOf = (row: Row) =>
      Option.match(row.provider ? registry.get(row.provider) : Option.none(), {
        onNone: () =>
          Effect.die(new Error(`Environment ${row.id} runs on ${row.provider}, which this Ren does not register`)),
        onSome: Effect.succeed,
      })

    // oxlint-disable-next-line ren/no-comments -- A hand's machine runs the template version it was made for, also after a failure, and keeps to its template's live host list.
    const desiredSetupOf = Effect.fnUntraced(function* (row: Row) {
      const template = (yield* database.db
        .select({ networking: templates.networking })
        .from(templates)
        .where(eq(templates.id, row.environment_template_id))
        .pipe(Effect.orDie)).at(0)
      const target = row.target
      return {
        config: target.config,
        image: Option.map(Option.fromNullishOr(target.image), (name) => ({
          name,
          template: {
            environmentTemplateId: target.environmentTemplateId,
            config: target.config,
            system: target.system,
          },
        })),
        hosts: template
          ? yield* network.hostsOf({ kind: "hand", id: row.id, generation: row.generation }, template.networking)
          : Option.none(),
      } satisfies MachineLifecycle.DesiredSetup
    })

    const runs = yield* FiberMap.make<Environment.ID>()

    // oxlint-disable-next-line ren/no-comments -- A remote hand's machine (EN1): the state machine of a brain's, with the executor's answer as its ready check. Its provider answers only when the executor does (MachineProvider.waitForExecutor). One server runs it (EN31); an access after a restart starts it again from its row.
    const hands = MachineLifecycle.make<Environment.ID, Row, Target, never>({
      name: "EnvironmentLifecycle",
      noun: "Environment",
      annotation: "environment",
      kind: "hand",
      providerOf,
      isBehindEgress,
      bootWithin: MachineLifecycle.timing.boot,
      wakeWithin: MachineLifecycle.timing.wake,
      read,
      update,
      replace: (row) =>
        update(row.id, {
          generation: row.generation + 1,
          binding: null,
          url: null,
          keep_alive_until: null,
          phase: "creating",
        }),
      forceReplace: (environmentId, generation) =>
        database.db
          .update(environments)
          .set({ phase: "replacing" })
          .where(
            and(
              eq(environments.id, environmentId),
              eq(environments.generation, generation),
              sql`${environments.phase} not in ('creating', 'replacing')`,
            ),
          )
          .returning({ id: environments.id })
          .pipe(
            Effect.orDie,
            Effect.map((rows) => rows.length > 0),
          ),
      isNeeded: () => Effect.succeed(false),
      ensure: (row): Effect.Effect<void> =>
        FiberMap.run(
          runs,
          row.id,
          Effect.suspend(() => hands.run(row.id)).pipe(
            Effect.catchCause((cause) => Effect.logWarning(`A step of environment ${row.id} failed`, cause)),
          ),
          { onlyIfMissing: true },
        ).pipe(Effect.asVoid),
      proxyFor: (row) =>
        sandboxEgress.proxyFor({
          workload: { kind: "hand", id: row.id, generation: row.generation },
          organizationId: row.organization_id,
        }),
      retire: (environmentId) => sandboxEgress.retire({ kind: "hand", id: environmentId }),
      startup: Effect.fnUntraced(function* (row) {
        const keys = yield* signingKeys
        const bundles = yield* currentBundles
        const variables = {
          ...ExecutorVariables.make(row.id, keys.publicKeys, { generation: row.generation }),
          ...sandboxVariables({ "ren.organization.id": row.organization_id, "ren.space.id": row.space_id }),
          REN_HAND: "1",
          ...Option.match(renUrl, { onNone: () => ({}), onSome: (url) => ({ REN_URL: url }) }),
          ...(Option.isSome(bundles) && {
            REN_BUNDLES: (yield* Effect.forEach(bundles.value, (bundle) =>
              Effect.map(code.token(bundle), (token) => [bundle.kind, bundle.version, bundle.sha256, token].join(":")),
            )).join(" "),
          }),
        }
        return {
          variables,
          created: database.db
            .update(environments)
            .set({ bundles: Option.getOrNull(Option.map(bundles, versionsOf)) })
            .where(eq(environments.id, row.id))
            .pipe(Effect.orDie, Effect.asVoid),
        }
      }),
      desiredSetup: (row) => desiredSetupOf(row),
      // oxlint-disable-next-line ren/no-comments -- A hand's machine always belongs to one template version, so its live host list is that template's.
      appliedHosts: (row) => Effect.map(desiredSetupOf(row), (desired) => desired.hosts),
      target: (row) =>
        Option.map(Option.fromNullishOr(row.url), (url) => ({
          environmentId: row.id,
          url,
          generation: row.generation,
          egress: row.egress,
        })),
      boot: () => Effect.succeedNone,
      wake: () => Effect.succeed(true),
      answers: (target) =>
        MachineProvider.executorAnswers(http, new URL(target.url)).pipe(
          Effect.timeoutOption(MachineLifecycle.timing.probeTimeout),
          Effect.option,
          Effect.map((answered) => Option.isSome(answered) && Option.isSome(answered.value)),
        ),
      // oxlint-disable-next-line ren/no-comments -- A hand has no brain to update its code in place, so newer bundles replace it (EN27, EN33).
      changeAtWake: Effect.fnUntraced(function* (row) {
        const bundles = yield* currentBundles
        if (Option.isNone(bundles)) return "current" as const
        const versions = versionsOf(bundles.value)
        return row.bundles?.dependencies === versions.dependencies && row.bundles.executor === versions.executor
          ? ("current" as const)
          : ("replace" as const)
      }),
    })

    // oxlint-disable-next-line ren/no-comments -- Deletes each hand machine where `where` holds, under its template's lock as an assign takes it, so a chat that takes a place meanwhile keeps its machine. Then destroys it with its files. Returns what it could not destroy; the daily cleanup tries again.
    const remove = Effect.fnUntraced(function* (where: SQL | undefined) {
      const found = yield* database.db
        .select({ id: environments.id, templateId: templates.id, provider: templates.provider })
        .from(environments)
        .innerJoin(templates, eq(templates.id, environments.environment_template_id))
        .where(where)
        .pipe(Effect.orDie)
      const removed = yield* Effect.forEach(found, (machine) =>
        database
          .transaction((transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .select({ id: templates.id })
                .from(templates)
                .where(eq(templates.id, machine.templateId))
                .for("update")
              const deleted = yield* transaction
                .delete(environments)
                .where(and(eq(environments.id, machine.id), where))
                .returning({ binding: environments.binding })
              return deleted.map((row) => Object.assign(machine, { binding: row.binding }))
            }),
          )
          .pipe(Effect.orDie),
      )
      return yield* Effect.forEach(
        removed.flat(),
        Effect.fnUntraced(function* (machine) {
          yield* FiberMap.remove(runs, machine.id)
          yield* sandboxEgress.retire({ kind: "hand", id: machine.id })
          const provider = registry.get(machine.provider)
          if (!machine.binding || Option.isNone(provider)) return []
          return yield* provider.value.destroy(machine.binding).pipe(
            Effect.as([]),
            Effect.catch((error) => Effect.succeed([`Hand machine ${machine.id} was not destroyed: ${error.message}`])),
          )
        }),
      ).pipe(Effect.map((problems) => problems.flat()))
    })

    // oxlint-disable-next-line ren/no-comments -- An access waits up to startingAfter for the machine's run that it started, then reads the machine again.
    const ready = Effect.fnUntraced(function* (environmentId: Environment.ID) {
      const first = yield* hands.access(environmentId)
      if (first._tag === "Ready") return first.target
      const running = yield* FiberMap.get(runs, environmentId)
      if (Option.isSome(running)) yield* Fiber.await(running.value).pipe(Effect.timeoutOption(startingAfter))
      const next = yield* hands.access(environmentId)
      if (next._tag === "Ready") return next.target
      if (next._tag === "Failed") return yield* new Unavailable({ message: next.reason })
      return yield* new Starting({ message: `The environment ${environmentId} is ${next.phase}` })
    })

    const grantAccess = Effect.fnUntraced(function* (
      subject: Subject,
      hand: Option.Option<Hand>,
      options: { readonly unreachable?: boolean },
    ): Effect.fn.Return<Environment.Access, NotFound | Unavailable | Starting> {
      if (Option.isSome(hand) && !(yield* isBound(subject))) {
        const exp = yield* expiry
        return {
          directory: handDirectory(hand.value, subject.sessionId),
          url: new URL(hand.value.url),
          token: Redacted.make(
            yield* signToken({
              environment: Environment.ofBrain(hand.value.brainId),
              brain: hand.value.brainId,
              generation: hand.value.generation,
              exp,
            }),
          ),
          expiresAt: DateTime.makeUnsafe(exp * 1000),
          generation: hand.value.generation,
          egress: hand.value.egress,
          sharedDirectory: `${hand.value.workspace}/.ren`,
        } satisfies Environment.Access
      }
      const templateRows = yield* database.db
        .select({ provider: templates.provider })
        .from(sessions)
        .innerJoin(templates, eq(templates.id, sessions.environment_template_id))
        .where(eq(sessions.session_id, subject.sessionId))
        .pipe(Effect.orDie)
      const provider = Option.flatMap(Option.fromNullishOr(templateRows.at(0)), (row) => registry.get(row.provider))
      if (Option.isNone(provider))
        return yield* new NotFound({
          message: `Session ${subject.sessionId} has no environment template this Ren can run`,
        })
      const assigned = yield* assign(subject)
      // oxlint-disable-next-line ren/no-comments -- EN15: the brain could not reach this hand; a gone or frozen machine is replaced, a running one kept.
      if (options.unreachable) yield* hands.check(assigned.environmentId)
      const target = yield* ready(assigned.environmentId).pipe(
        Effect.catchTag("Environments.Unavailable", (error) =>
          Effect.fail(
            new Unavailable({
              message: `The environment of session ${subject.sessionId} is unavailable: ${error.message}`,
            }),
          ),
        ),
      )
      const exp = yield* expiry
      return {
        directory: directoryOf(provider.value, subject.sessionId),
        url: new URL(target.url),
        token: Redacted.make(
          yield* signToken({
            environment: assigned.environmentId,
            brain: assigned.brainId,
            generation: target.generation,
            exp,
          }),
        ),
        expiresAt: DateTime.makeUnsafe(exp * 1000),
        generation: target.generation,
        egress: target.egress,
        // oxlint-disable-next-line ren/no-comments -- R49, R59: the folder beside the session folders, which every session on the environment shares.
        sharedDirectory: `${Option.getOrElse(provider.value.workspace, () => config.directory)}/.ren`,
      } satisfies Environment.Access
    })

    const bind = Effect.fn("Environments.bind")(function* (placement: Subject & Placement, version: Machine.Version) {
      const environmentTemplateId = version.environmentTemplateId
      return yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const provider = yield* checkAvailable(transaction, placement, environmentTemplateId)
          const inserted = yield* transaction
            .insert(sessions)
            .values({
              session_id: placement.sessionId,
              space_id: placement.spaceId,
              environment_template_id: environmentTemplateId,
              target: version,
            })
            .onConflictDoNothing()
            .returning({ session_id: sessions.session_id })
            .pipe(Effect.orDie)
          if (inserted.length > 0) return { directory: directoryOf(provider, placement.sessionId), isNew: true }
          const existing = yield* transaction
            .select({ environment_template_id: sessions.environment_template_id, space_id: sessions.space_id })
            .from(sessions)
            .where(eq(sessions.session_id, placement.sessionId))
            .pipe(Effect.orDie)
          const found = existing.at(0)
          if (found?.environment_template_id === environmentTemplateId && found.space_id === placement.spaceId)
            return { directory: directoryOf(provider, placement.sessionId), isNew: false }
          return yield* new Changed({
            message: `Session ${placement.sessionId} cannot change its environment template or space: not supported yet`,
          })
        }),
      )
    })

    return Service.of({
      bind,
      findDirectory: Effect.fn("Environments.findDirectory")(function* (subject: Subject, hand: Option.Option<Hand>) {
        if (Option.isSome(hand) && !(yield* isBound(subject)))
          return Option.some(handDirectory(hand.value, subject.sessionId))
        const rows = yield* database.db
          .select({ environmentTemplateId: sessions.environment_template_id, provider: templates.provider })
          .from(sessions)
          .innerJoin(templates, eq(templates.id, sessions.environment_template_id))
          .where(and(eq(sessions.session_id, subject.sessionId), isAvailable(subject.organizationId)))
          .pipe(Effect.orDie)
        return Option.flatMap(Option.fromNullishOr(rows.at(0)), (row) =>
          Option.map(registry.get(row.provider), (provider) => directoryOf(provider, subject.sessionId)),
        )
      }),
      capabilities: Effect.fn("Environments.capabilities")(function* (
        organizationId: Auth.OrganizationID,
        sessionIds: ReadonlyArray<Session.ID>,
        hand: Option.Option<Hand>,
      ) {
        const bound =
          sessionIds.length === 0
            ? []
            : yield* database.db
                .select({ sessionId: sessions.session_id, provider: templates.provider })
                .from(sessions)
                .leftJoin(
                  templates,
                  and(eq(templates.id, sessions.environment_template_id), isAvailable(organizationId)),
                )
                .where(inArray(sessions.session_id, [...sessionIds]))
                .pipe(Effect.orDie)
        const providers = new Map(bound.map((row) => [row.sessionId, row.provider]))
        return new Map(
          sessionIds.flatMap((sessionId) => {
            const capability = providers.has(sessionId)
              ? Option.map(
                  Option.flatMap(Option.fromNullishOr(providers.get(sessionId)), registry.get),
                  (provider) => ({
                    canMount: provider.canMount,
                    egress: isBehindEgress(provider),
                  }),
                )
              : Option.map(hand, (found) => ({ canMount: found.canMount, egress: found.egress }))
            return Option.isSome(capability) ? [[sessionId, capability.value] as const] : []
          }),
        )
      }),
      apply: Effect.fn("Environments.apply")(function* (
        transaction: Database.Transaction,
        brainId: Brain.ID,
        hand: Space.AppliedHand,
      ) {
        const chats = yield* transaction
          .select({ id: Database.Schema.agent_session.id, spaceId: Database.Schema.agent_session.space_id })
          .from(Database.Schema.agent_session)
          .where(
            and(eq(Database.Schema.agent_session.brain_id, brainId), isNull(Database.Schema.agent_session.parent_id)),
          )
        if (chats.length === 0) return
        const ids = chats.map((chat) => chat.id)
        if (hand.placement !== "remote") {
          yield* transaction.delete(sessions).where(inArray(sessions.session_id, ids))
          return
        }
        const target = hand.version
        yield* transaction
          .delete(sessions)
          .where(
            and(
              inArray(sessions.session_id, ids),
              notInArray(sessions.environment_template_id, [target.environmentTemplateId]),
            ),
          )
        yield* transaction.update(sessions).set({ target }).where(inArray(sessions.session_id, ids))
        yield* transaction
          .insert(sessions)
          .values(
            chats.map((chat) => ({
              session_id: chat.id,
              space_id: chat.spaceId,
              environment_template_id: target.environmentTemplateId,
              target,
            })),
          )
          .onConflictDoNothing()
      }),
      workspaceOf: (provider: EnvironmentProvider.ID) =>
        Option.getOrElse(
          Option.flatMap(registry.get(provider), (found) => found.workspace),
          () => config.directory,
        ),
      handHosts: Effect.fn("Environments.handHosts")(function* (environmentTemplateId: EnvironmentTemplate.ID) {
        const found = (yield* database.db
          .select({ provider: templates.provider })
          .from(templates)
          .where(eq(templates.id, environmentTemplateId))
          .pipe(Effect.orDie)).at(0)
        if (!found) return []
        return Option.match(registry.get(found.provider), {
          onNone: () => [],
          onSome: (provider) => provider.machineHosts,
        })
      }),
      unbind: Effect.fn("Environments.unbind")(function* (subject: Subject) {
        yield* database.db.delete(sessions).where(isSessionOf(subject)).pipe(Effect.orDie)
      }),
      access: Effect.fn("Environments.access")(function* (
        subject: Subject,
        hand: Option.Option<Hand>,
        options: { readonly unreachable?: boolean } = {},
      ) {
        return yield* grantAccess(subject, hand, options)
      }),
      renew: Effect.fn("Environments.renew")(function* (sessionIds: ReadonlyArray<Session.ID>) {
        if (sessionIds.length === 0) return
        const at = new Date(yield* Clock.currentTimeMillis)
        yield* database.db
          .update(sessions)
          .set({ reserved_until: new Date(at.getTime() + Duration.toMillis(reservation)) })
          .where(and(inArray(sessions.session_id, [...sessionIds]), gt(sessions.reserved_until, at)))
          .pipe(Effect.orDie)
      }),
      // oxlint-disable-next-line ren/no-comments -- EN25: a chat's background process runs on its remote hand, so the hand stays awake for it as the brain does, up to 2 h after the chat's last progress. A hand that is asleep stays asleep.
      keepAwake: Effect.fn("Environments.keepAwake")(function* (
        sessionIds: ReadonlyArray<Session.ID>,
        lastProgressAt: Date,
      ) {
        if (sessionIds.length === 0) return
        const at = new Date(yield* Clock.currentTimeMillis)
        const awake = yield* database.db
          .selectDistinct({ environment: environments })
          .from(sessions)
          .innerJoin(environments, eq(environments.id, sessions.environment_id))
          .where(
            and(
              inArray(sessions.session_id, [...sessionIds]),
              eq(environments.phase, "ready"),
              gt(environments.keep_alive_until, at),
            ),
          )
          .pipe(Effect.orDie)
        yield* Effect.forEach(
          awake,
          Effect.fnUntraced(function* (found) {
            const row = yield* read(found.environment.id)
            yield* hands.keepAwake({ ...row, last_progress_at: lastProgressAt }, { isBusy: false, hasBackground: true })
          }),
          { discard: true },
        )
      }),
      shutdown: Effect.fn("Environments.shutdown")(function* (spaceId: Space.ID) {
        return yield* remove(eq(environments.space_id, spaceId))
      }),
      cleanup: Effect.gen(function* () {
        const at = new Date(yield* Clock.currentTimeMillis)
        const isUnused = and(
          notExists(
            database.db
              .select({ id: sessions.session_id })
              .from(sessions)
              .where(and(eq(sessions.environment_id, environments.id), gt(sessions.reserved_until, at))),
          ),
          or(isNull(environments.keep_alive_until), lte(environments.keep_alive_until, at)),
        )
        yield* remove(isUnused).pipe(
          Effect.flatMap((problems) =>
            Effect.forEach(problems, (problem) => Effect.logWarning(problem), { discard: true }),
          ),
        )
        const listed = (yield* Effect.forEach(registry.providers, (provider) =>
          provider.list.pipe(
            Effect.map((all) => all.flatMap((each) => (each.kind === "hand" ? [{ ...each, provider }] : []))),
            Effect.catch((error) =>
              Effect.logWarning(`Cleanup could not list the machines of ${provider.info.id}`, error).pipe(
                Effect.as([]),
              ),
            ),
          ),
        )).flat()
        const known = new Map(
          (yield* database.db
            .select({ id: environments.id, generation: environments.generation })
            .from(environments)
            .where(
              inArray(
                environments.id,
                listed.map((each) => each.id),
              ),
            )
            .pipe(Effect.orDie)).map((each) => [each.id, each.generation]),
        )
        yield* Effect.forEach(
          listed.filter((each) => known.get(each.id) !== each.generation),
          (each) =>
            each.provider
              .destroy(each.binding)
              .pipe(Effect.catch((error) => Effect.logWarning(`Cleanup of a sandbox of ${each.id} failed`, error))),
          { discard: true },
        )
      }).pipe(Effect.withSpan("Environments.cleanup")),
      refreshNetworks: Effect.fn("Environments.refreshNetworks")(function* (spaceId: Space.ID) {
        const awake = yield* database.db
          .select({ id: environments.id })
          .from(environments)
          .where(and(eq(environments.space_id, spaceId), eq(environments.phase, "ready")))
          .pipe(Effect.orDie)
        yield* Effect.forEach(awake, (row) => hands.refreshNetwork(row.id), { discard: true })
      }),
      executorVariables: Effect.fn("Environments.executorVariables")(function* (
        environmentId: Environment.ID,
        generation: number,
      ) {
        const keys = yield* signingKeys
        return ExecutorVariables.make(environmentId, keys.publicKeys, { generation })
      }),
    })
  }),
)
