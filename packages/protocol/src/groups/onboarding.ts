import { Onboarding } from "@ren/schema/onboarding"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ForbiddenError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const OnboardingGroup = HttpApiGroup.make("onboarding")
  .add(
    HttpApiEndpoint.get("onboarding.get", "/onboarding", {
      success: Onboarding.Info,
      error: ForbiddenError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "onboarding.get",
        summary: "Get the onboarding checklists",
        description:
          "Return the organization’s checklist and the caller’s own one. Each lists every step in order, with the time it was first completed, and when the checklist was hidden.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("onboarding.complete", "/onboarding/complete", {
      payload: Onboarding.CompleteInput,
      success: Onboarding.Info,
      error: ForbiddenError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "onboarding.complete",
        summary: "Mark a personal onboarding step done",
        description:
          "Mark one of the caller’s own steps done that Ren cannot see happen, such as starring Ren on GitHub or importing memory from another agent. Only those steps are accepted, and none pays a reward. Marking it again keeps the first time.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("onboarding.dismiss", "/onboarding/dismiss", {
      payload: Onboarding.DismissInput,
      success: Onboarding.Info,
      error: ForbiddenError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "onboarding.dismiss",
        summary: "Hide an onboarding checklist",
        description:
          "Hide the organization’s checklist for every member, or the caller’s own one for the caller. Steps still complete after it. Hiding it again keeps the first time.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "internal")
  .annotateMerge(OpenApi.annotations({ title: "onboarding" }))
