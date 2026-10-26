import { Auth } from "@ren/schema/auth"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Exposure } from "../exposure.js"

export const SignInGroup = HttpApiGroup.make("sign-in")
  .add(
    HttpApiEndpoint.get("sign-in-provider.list", "/sign-in-providers", {
      success: Auth.SignInProviders,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "sign-in-provider.list",
        summary: "List sign-in providers",
        description: "Return the accounts that a person can sign in with on this Ren server, besides email.",
      }),
    ),
  )
  .annotate(Exposure, "internal")
  .annotateMerge(OpenApi.annotations({ title: "sign-in" }))
