export * as ChannelInstallPolicy from "./policy.js"

import { ChannelInstall } from "@ren/schema/channel-install"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import { SpacePolicy } from "../space/policy.js"

export const documents = [
  {
    primitive: ChannelInstall.definition.name,
    statements: [
      {
        actions: Primitive.actions(ChannelInstall.definition),
        roles: SpacePolicy.organizationRoles,
        on: Policy.everywhere,
      },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>
