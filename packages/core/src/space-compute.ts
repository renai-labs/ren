export * as SpaceCompute from "./space-compute.js"

import { Database } from "@ren/db/database"
import type { Brain } from "@ren/schema/brain"
import type { EnvironmentProvider } from "@ren/schema/environment-provider"
import type { EnvironmentTemplate } from "@ren/schema/environment-template"
import type { Space } from "@ren/schema/space"
import { eq } from "drizzle-orm"
import { Context, Effect, Layer, Option } from "effect"
import { BrainProvider } from "./brain-provider.js"
import { Environments } from "./environments.js"

// oxlint-disable-next-line ren/no-comments -- What a brain's start or wake does with the space's settings: apply them to the running machine, or replace the machine first because it cannot run them.
export type Plan =
  | { readonly _tag: "Apply"; readonly hand: Space.AppliedHand }
  | { readonly _tag: "Replace"; readonly reason: string }

export interface Desired {
  readonly provider: EnvironmentProvider.ID | null
  readonly hand: Space.AppliedHand
  // oxlint-disable-next-line ren/no-comments -- The folder of a remote hand's chats on its provider; none for another hand.
  readonly workspace: Option.Option<string>
  readonly revision: number
}

// oxlint-disable-next-line ren/no-comments -- The machine a brain runs on now. None for a new machine, or a host with no machine of its own, such as a cell: either runs the desired settings as they are.
export interface Machine {
  readonly provider: string | null
  // oxlint-disable-next-line ren/no-comments -- The brain was made for a remote hand: OpenCode's saved output, file panel, git and snapshots go to the hand (EN13). It is fixed for the life of the process.
  readonly isRemote: boolean
  readonly hand: Space.AppliedHand | null
  readonly workspace: Option.Option<string>
}

// oxlint-disable-next-line ren/no-comments -- A chat gets a folder on a remote hand only when its brain restores it: a remote brain whose chats had no tools, or whose hand keeps folders elsewhere, starts again.
const remoteProblem = (running: Machine, desired: Desired): string | undefined => {
  if (running.hand?.placement === "none") return "the chats get a remote hand"
  if (Option.isSome(running.workspace) && Option.isSome(desired.workspace))
    return running.workspace.value === desired.workspace.value
      ? undefined
      : "the remote hand keeps its chats’ folders in another place"
  return undefined
}

export const plan = (machine: Option.Option<Machine>, desired: Desired): Plan => {
  if (Option.isNone(machine)) return { _tag: "Apply", hand: desired.hand }
  const running = machine.value
  if (running.provider && desired.provider && running.provider !== desired.provider)
    return { _tag: "Replace", reason: `the brain provider changed from ${running.provider} to ${desired.provider}` }
  if (desired.hand.placement === "none") return { _tag: "Apply", hand: desired.hand }
  if (running.isRemote !== (desired.hand.placement === "remote"))
    return {
      _tag: "Replace",
      reason: running.isRemote ? "the tools move to the brain’s machine" : "the tools move to a remote hand",
    }
  const problem = desired.hand.placement === "remote" ? remoteProblem(running, desired) : undefined
  return problem ? { _tag: "Replace", reason: problem } : { _tag: "Apply", hand: desired.hand }
}

export interface Interface {
  // oxlint-disable-next-line ren/no-comments -- Applies the space's settings to the brain, in one transaction with the bindings of its chats, unless the plan is to replace its machine. A new machine also takes the space's hand as its kind.
  readonly publish: (
    brainId: Brain.ID,
    options: { readonly machine: "new" | "running" | "none" },
  ) => Effect.Effect<Plan>
  // oxlint-disable-next-line ren/no-comments -- The plan for the brain's running machine, without applying it.
  readonly check: (brainId: Brain.ID) => Effect.Effect<Plan>
  // oxlint-disable-next-line ren/no-comments -- The hand the brain's chats use now, and the space revision it applied. A brain that has applied none yet applies the space's now, when its machine can run it.
  readonly applied: (brainId: Brain.ID) => Effect.Effect<Applied>
}

export interface Applied {
  readonly hand: Space.AppliedHand
  readonly revision: number
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SpaceCompute") {}

const spaces = Database.Schema.space
const brains = Database.Schema.brain
const templates = Database.Schema.environment_template

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const environments = yield* Environments.Service
    const brainProviders = yield* BrainProvider.Registry
    const deploymentProvider = Option.getOrNull(
      Option.map(BrainProvider.defaultOf(brainProviders), (provider) => provider.info.id),
    )

    const versionOf = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      environmentTemplateId: EnvironmentTemplate.ID,
    ) {
      const template = (yield* transaction
        .select({
          provider: templates.provider,
          config: templates.config,
          image: templates.image,
          imageConfig: templates.image_config,
          system: templates.image_system,
        })
        .from(templates)
        .where(eq(templates.id, environmentTemplateId))
        .for("share")).at(0)
      if (!template) return yield* Effect.die(new Error(`Environment template ${environmentTemplateId} does not exist`))
      return {
        version: {
          environmentTemplateId,
          image: template.image,
          config: template.imageConfig ?? template.config,
          system: template.system,
        },
        workspace: environments.workspaceOf(template.provider),
      }
    })

    const desiredOf = Effect.fnUntraced(function* (transaction: Database.Transaction, spaceId: Space.ID) {
      const space = (yield* transaction
        .select({
          provider: spaces.brain_provider,
          placement: spaces.hand_placement,
          templateId: spaces.environment_template_id,
          revision: spaces.compute_revision,
        })
        .from(spaces)
        .where(eq(spaces.id, spaceId))
        .for("share")).at(0)
      if (!space) return yield* Effect.die(new Error(`Space ${spaceId} does not exist`))
      const provider = space.provider ?? deploymentProvider
      if (space.placement === "remote" && space.templateId) {
        const found = yield* versionOf(transaction, space.templateId)
        return {
          provider,
          hand: { placement: "remote", version: found.version },
          workspace: Option.some(found.workspace),
          revision: space.revision,
        } satisfies Desired
      }
      return {
        provider,
        hand: { placement: space.placement === "none" ? "none" : "colocated" },
        workspace: Option.none(),
        revision: space.revision,
      } satisfies Desired
    })

    const workspaceOfHand = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      hand: Space.AppliedHand | null,
    ) {
      if (hand?.placement !== "remote") return Option.none<string>()
      return Option.some((yield* versionOf(transaction, hand.version.environmentTemplateId)).workspace)
    })

    const decide = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      brainId: Brain.ID,
      machine: "new" | "running" | "none",
    ) {
      const row = (yield* transaction
        .select({
          spaceId: brains.space_id,
          provider: brains.provider,
          placement: brains.hand_placement,
          hand: brains.hand,
        })
        .from(brains)
        .where(eq(brains.id, brainId))
        .for("update")).at(0)
      if (!row) return yield* Effect.die(new Error(`Brain ${brainId} does not exist`))
      const desired = yield* desiredOf(transaction, row.spaceId)
      const running =
        machine === "running"
          ? Option.some({
              provider: row.provider,
              isRemote: row.placement === "remote",
              hand: row.hand,
              workspace: yield* workspaceOfHand(transaction, row.hand),
            } satisfies Machine)
          : Option.none<Machine>()
      return { plan: plan(running, desired), revision: desired.revision }
    })

    const publish = Effect.fn("SpaceCompute.publish")(function* (
      brainId: Brain.ID,
      options: { readonly machine: "new" | "running" | "none" },
    ) {
      return yield* database.transaction((transaction) =>
        Effect.gen(function* () {
          const found = yield* decide(transaction, brainId, options.machine)
          const decided = found.plan
          const desired = { revision: found.revision }
          if (decided._tag === "Replace") return decided
          yield* transaction
            .update(brains)
            .set({
              hand: decided.hand,
              compute_revision: desired.revision,
              ...(options.machine === "new" && { hand_placement: decided.hand.placement }),
            })
            .where(eq(brains.id, brainId))
          yield* environments.apply(transaction, brainId, decided.hand)
          return decided
        }),
      )
    })

    return Service.of({
      publish,
      check: Effect.fn("SpaceCompute.check")(function* (brainId: Brain.ID) {
        return (yield* database.transaction((transaction) => decide(transaction, brainId, "running"))).plan
      }),
      applied: Effect.fn("SpaceCompute.applied")(function* (brainId: Brain.ID) {
        const read = database.db
          .select({ hand: brains.hand, revision: brains.compute_revision })
          .from(brains)
          .where(eq(brains.id, brainId))
          .pipe(
            Effect.orDie,
            Effect.flatMap((rows) => {
              const row = rows.at(0)
              return row ? Effect.succeed(row) : Effect.die(new Error(`Brain ${brainId} does not exist`))
            }),
          )
        const row = yield* read
        if (row.hand) return { hand: row.hand, revision: row.revision } satisfies Applied
        // oxlint-disable-next-line ren/no-comments -- A brain made before applied hands were kept: its machine keeps its kind, so it takes the space's hand only when it can run it, and no tools until its next wake otherwise.
        const decided = yield* publish(brainId, { machine: "running" })
        if (decided._tag === "Replace") return { hand: { placement: "none" }, revision: row.revision } satisfies Applied
        const published = yield* read
        return { hand: decided.hand, revision: published.revision } satisfies Applied
      }),
    })
  }),
)
