import { Auth } from "@ren/schema/auth"
import { Context } from "effect"
import { HttpApiMiddleware } from "effect/http-api"
import { ForbiddenError } from "../errors.js"
import { CurrentSession } from "./authentication.js"

export class CurrentOrganization extends Context.Service<
  CurrentOrganization,
  { readonly id: Auth.OrganizationID; readonly roles: ReadonlyArray<string> }
>()("@ren/protocol/CurrentOrganization") {}

export class ActiveOrganization extends HttpApiMiddleware.Service<
  ActiveOrganization,
  { provides: CurrentOrganization; requires: CurrentSession }
>()("@ren/protocol/ActiveOrganization", { error: ForbiddenError }) {}
