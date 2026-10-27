import { Drive } from "@ren/schema/drive"
import { WriteResult } from "@ren/schema/write-result"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ForbiddenError, InvalidRequestError, NotFoundError, UnavailableError } from "../errors.js"
import { Exposure } from "../exposure.js"
import { ActiveOrganization } from "../middleware/active-organization.js"
import { Authentication } from "../middleware/authentication.js"

const scope =
  "Pass spaceId for a space’s drive; omit it for the organization’s drive. Every chat in scope reads the drive’s files on its environment, read-only."

export const DriveGroup = HttpApiGroup.make("drive")
  .add(
    HttpApiEndpoint.get("drive.list", "/drive", {
      query: Drive.ListInput,
      success: Drive.Listing,
      error: [NotFoundError, ForbiddenError, InvalidRequestError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "drive.list",
        summary: "List a drive folder",
        description: `List the folders and files directly in one folder of a drive, one page at a time. ${scope}`,
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("drive.startUpload", "/drive/uploads", {
      payload: Drive.StartUploadInput,
      success: WriteResult.Upload,
      error: [NotFoundError, ForbiddenError, InvalidRequestError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "drive.startUpload",
        summary: "Start a drive upload",
        description: `Get a form that uploads one file to a path of a drive: POST its fields, then the file as the field \`file\`, to uploadUrl before expiresAt. The file must be exactly size bytes. ${scope}`,
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("drive.download", "/drive/file", {
      query: Drive.PathInput,
      success: Drive.Link,
      error: [NotFoundError, ForbiddenError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "drive.download",
        summary: "Download a drive file",
        description: `Get a link that downloads one file of a drive until expiresAt. ${scope}`,
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("drive.delete", "/drive/file", {
      query: Drive.PathInput,
      success: HttpApiSchema.NoContent,
      error: [NotFoundError, ForbiddenError, UnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "drive.delete",
        summary: "Delete a drive file",
        description: `Delete one file of a drive. ${scope}`,
      }),
    ),
  )
  .middleware(ActiveOrganization)
  .middleware(Authentication)
  .annotate(Exposure, "sdk")
  .annotateMerge(OpenApi.annotations({ title: "drive" }))
