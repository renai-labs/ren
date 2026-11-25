import { Onboarding } from "@ren/schema/onboarding"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ForbiddenError, NotFoundError } from "../errors.js"
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
    HttpApiEndpoint.post("onboarding.report", "/onboarding/report", {
      payload: Onboarding.ReportInput,
      success: Onboarding.Info,
      error: ForbiddenError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "onboarding.report",
        summary: "Report an onboarding step",
        description:
          "Complete a step of the caller’s own checklist that Ren cannot check, such as starring Ren on GitHub. Reporting it again keeps the first time.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("onboarding.importMemory", "/onboarding/memory", {
      payload: Onboarding.ImportMemoryInput,
      success: Onboarding.Info,
      error: [NotFoundError, ForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "onboarding.importMemory",
        summary: "Import memory from another agent",
        description:
          "Add what another agent exported about the caller to the end of a space’s root memory file, and complete the caller’s memory import step.",
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
