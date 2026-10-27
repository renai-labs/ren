export * as InfraPolicy from "./policy.js"

import type { Policy } from "@ren/schema/policy"
import { SpacePolicy } from "../space/policy.js"

export const actions = { plan: "infra.plan", apply: "infra.apply", pull: "infra.pull" } as const

export const documents = [
  {
    resource: "infra",
    rules: [
      {
        actions: [actions.plan, actions.apply, actions.pull],
        effect: "allow",
        roles: SpacePolicy.administratorRoles,
        when: [],
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
