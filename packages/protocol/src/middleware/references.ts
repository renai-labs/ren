import { Primitive } from "@ren/schema/primitive"
import { HttpApiMiddleware } from "effect/http-api"
import { NotFoundError } from "../errors.js"
import { CurrentOrganization } from "./active-organization.js"
import { CurrentUser } from "./authentication.js"

export class References extends HttpApiMiddleware.Service<
  References,
  { provides: Primitive.Resolver; requires: CurrentUser | CurrentOrganization }
>()("@ren/protocol/References", { error: NotFoundError }) {}
