export * as Actor from "./actor.js"

import { Auth } from "@ren/schema/auth"

export interface Info {
  readonly userId: Auth.UserID
  readonly organizationId: Auth.OrganizationID
  readonly roles: ReadonlyArray<string>
}
