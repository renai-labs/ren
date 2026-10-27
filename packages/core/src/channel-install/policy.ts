export * as ChannelInstallPolicy from "./policy.js"

import { Auth } from "@ren/schema/auth"
import { ChannelInstall } from "@ren/schema/channel-install"
import type { Policy } from "@ren/schema/policy"
import { Primitive } from "@ren/schema/primitive"
import type { Access } from "../access.js"

const facts = { installer: "channelInstall.installer" } as const

const changeActions = Primitive.actions(ChannelInstall.definition, ["update", "remove"])

// oxlint-disable-next-line ren/no-comments -- Admins and the installer change an install.
export const documents = [
  {
    resource: ChannelInstall.definition.name,
    rules: [
      {
        actions: Primitive.actions(ChannelInstall.definition, ["list"]),
        effect: "allow",
        roles: Auth.Role.literals,
        when: [],
      },
      { actions: changeActions, effect: "allow", roles: Auth.administratorRoles, when: [] },
      { actions: changeActions, effect: "allow", roles: Auth.Role.literals, when: [facts.installer] },
    ],
  },
] satisfies ReadonlyArray<typeof Policy.Document.Encoded>

export const resource = (isInstaller: boolean): Access.Resource => ({
  facts: isInstaller ? [facts.installer] : [],
})
