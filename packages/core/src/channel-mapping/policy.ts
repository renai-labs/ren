export * as ChannelMappingPolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpacePolicy } from "../space/policy.js"

const writeActions = Primitive.actions(ChannelMapping.definition, ["create", "remove"])

export const documents = [
  {
    primitive: ChannelMapping.definition.name,
    statements: [
      {
        actions: Primitive.actions(ChannelMapping.definition, ["list"]),
        roles: Auth.Role.literals,
        on: Policy.everywhere,
      },
      { actions: writeActions, roles: Auth.administratorRoles, on: Policy.everywhere },
      { actions: writeActions, roles: Auth.Role.literals, on: SpacePolicy.member },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
