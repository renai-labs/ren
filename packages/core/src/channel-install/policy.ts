export * as ChannelInstallPolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { ChannelInstall } from "@ren/schema/channel-install"
import { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Access } from "../access.js"

const installer = "channelInstall.installer"

const changeActions = Primitive.actions(ChannelInstall.definition, ["update", "remove"])

export const documents = [
  {
    primitive: ChannelInstall.definition.name,
    statements: [
      {
        actions: Primitive.actions(ChannelInstall.definition, ["list"]),
        roles: Auth.Role.literals,
        on: Policy.everywhere,
      },
      { actions: changeActions, roles: Auth.administratorRoles, on: Policy.everywhere },
      { actions: changeActions, roles: Auth.Role.literals, on: installer },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const resource = (isInstaller: boolean): Access.Resource => ({
  relationships: isInstaller ? [installer] : [],
})
