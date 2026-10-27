export * as ChannelMappingPolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpacePolicy } from "../space/policy.js"

const writeActions = Primitive.actions(ChannelMapping.definition, ["create", "remove"])

// oxlint-disable-next-line ren/no-comments -- access §13: members map their space; admins map shared spaces only.
export const documents = [
  {
    resource: ChannelMapping.definition.name,
    rules: [
      {
        actions: Primitive.actions(ChannelMapping.definition, ["list"]),
        effect: "allow",
        roles: Auth.Role.literals,
        when: [],
      },
      { actions: writeActions, effect: "allow", roles: Auth.administratorRoles, when: [SpacePolicy.facts.shared] },
      { actions: writeActions, effect: "allow", roles: Auth.Role.literals, when: [SpacePolicy.facts.member] },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
