import { AppProfile } from "@ren/schema/app-profile"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"
import { Primitive } from "../primitive.js"

const errors = [NotFoundError, ForbiddenError, ConflictError]

export const AppProfileGroup = Primitive.group(AppProfile.definition, "sdk", [
  Primitive.list(AppProfile.definition),
  Primitive.get(AppProfile.definition),
  Primitive.create(AppProfile.definition),
  Primitive.update(AppProfile.definition),
  HttpApiEndpoint.post("app-profile.access", "/app-profiles/:id/access", {
    params: { id: AppProfile.ID },
    payload: AppProfile.AccessInput,
    success: AppProfile.Info,
    error: errors,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "app-profile.access",
      summary: "Change the spaces of a shared profile",
      description:
        "Add or remove listed spaces, or share with every space. A member changes only spaces they belong to.",
    }),
  ),
  Primitive.action(AppProfile.definition, "link"),
  HttpApiEndpoint.post("app-profile.promote", "/app-profiles/:id/promote", {
    params: { id: AppProfile.ID },
    payload: AppProfile.PromoteInput,
    success: AppProfile.Info,
    error: errors,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "app-profile.promote",
      summary: "Share a private profile",
      description: "Turn your private profile into a shared one that lists your spaces. Its accounts and labels stay.",
    }),
  ),
])

export const AppProfileReachGroup = HttpApiGroup.make("app-profile-reach")
  .add(
    HttpApiEndpoint.delete("app-profile.delete", "/app-profiles/:id", {
      params: { id: AppProfile.ID },
      success: AppProfile.Info,
      error: [NotFoundError, ForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "app-profile.delete",
        summary: "Delete app profile",
        description: "Delete a profile and its credentials. Spaces that reached it stop using its accounts at once.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("session.profiles", "/sessions/:id/profiles", {
      params: { id: Session.ID },
      success: AppProfile.Reach,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "session.profiles",
        summary: "List the profiles a chat reaches",
        description: "Return the app profiles the chat can use, each with its items and their status.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("space.profiles", "/spaces/:id/profiles", {
      params: { id: Space.ID },
      success: AppProfile.Reach,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "space.profiles",
        summary: "List the profiles a new chat reaches",
        description: "Return the app profiles a new chat of the caller in this space can use, with their gaps.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "app-profile-reach" }))
