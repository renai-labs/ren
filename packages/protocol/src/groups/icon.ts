import { ResourceIcon } from "@ren/schema/resource-icon"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { InvalidRequestError, UnavailableError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { Authentication } from "../middleware/authentication.js"

export const IconGroup = HttpApiGroup.make("icon")
  .add(
    HttpApiEndpoint.post("icon.upload", "/icons", {
      payload: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      success: ResourceIcon.Upload,
      error: [InvalidRequestError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "icon.upload",
        summary: "Upload an icon",
        description:
          "Crop a PNG, JPEG or WebP image of at most 512 KB to a 256×256 WebP and return its public URL. The same image gives the same URL.",
      }),
    ),
  )
  .middleware(Authentication)
  .annotate(Exposure, "internal")
  .annotateMerge(OpenApi.annotations({ title: "icon" }))
