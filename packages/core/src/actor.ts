export * as Actor from "./actor.js"

import type { Agent } from "@ren/schema/agent"
import { Auth } from "@ren/schema/auth"
import type { Session } from "@ren/schema/session"
import type { Space } from "@ren/schema/space"

export interface Info {
  readonly userId: Auth.UserID
  readonly organizationId: Auth.OrganizationID
  readonly roles: ReadonlyArray<string>
  readonly agent?: {
    readonly agentId: Agent.ID
    readonly sessionId: Session.ID
    readonly spaceId: Space.ID
  }
}
