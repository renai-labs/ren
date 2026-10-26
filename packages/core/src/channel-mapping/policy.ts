export * as ChannelMappingPolicy from "./policy.js"

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
        roles: SpacePolicy.organizationRoles,
        on: Policy.everywhere,
      },
      { actions: writeActions, roles: SpacePolicy.administratorRoles, on: Policy.everywhere },
      { actions: writeActions, roles: SpacePolicy.organizationRoles, on: "space.member" },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
