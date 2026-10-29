import { Infra } from "@ren/schema/infra"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ConflictError, ForbiddenError, InvalidRequestError, NotFoundError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const InfraGroup = HttpApiGroup.make("infra")
  .add(
    HttpApiEndpoint.post("infra.pull", "/infra/pull", {
      payload: Infra.PullInput,
      success: Infra.Pulled,
      error: [ForbiddenError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "infra.pull",
        summary: "Pull the org spec",
        description:
          "Return the organization settings and the shared spaces as an org spec, with the resources that the folder should write and remove. A resource that changed in the folder and in Ren is a conflict. Needs an organization admin.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("infra.plan", "/infra/plan", {
      payload: Infra.PlanInput,
      success: Infra.Plan,
      error: ForbiddenError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "infra.plan",
        summary: "Plan an org spec",
        description:
          "Return the changes that would make the organization match the spec, the problems that stop it, and the digest that apply needs.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("infra.apply", "/infra/apply", {
      payload: Infra.ApplyInput,
      success: Infra.Applied,
      error: [NotFoundError, ForbiddenError, ConflictError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "infra.apply",
        summary: "Apply an org spec",
        description:
          "Plan the spec again and write its changes, when the digest matches. A conflict refuses the apply unless force is set. A failed write stops apply and names its change; the writes before it stay.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "infra" }))
