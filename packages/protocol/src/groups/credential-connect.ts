import { Credential } from "@ren/schema/credential"
import { WriteResult } from "@ren/schema/write-result"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { ForbiddenError, InvalidRequestError, NotFoundError, ConflictError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

export const CredentialConnectGroup = HttpApiGroup.make("credential-connect")
  .add(
    HttpApiEndpoint.post("credential.connect", "/credentials/connect", {
      payload: Credential.ConnectInput,
      success: Schema.Union([WriteResult.Redirect, Credential.Info]),
      error: [NotFoundError, ForbiddenError, ConflictError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.connect",
        summary: "Connect an MCP",
        description:
          "Start a sign-in for one MCP of an app and return the address of the consent page, or return the credential when it is already connected and `reconnect` is not set. Read the sign-in with `oauth-session.get`.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("credential.requirements", "/credential-requirements", {
      query: Credential.RequirementsInput,
      success: Credential.Requirements,
      error: NotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.requirements",
        summary: "List what an app needs connected",
        description:
          "Return the items of an app’s connect dialog in a space: one per MCP that needs a credential and one per env key, then the items of the apps it depends on, with the status of each.",
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "credential-connect" }))
